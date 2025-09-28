# 概要
Cloudflare Free プランのアップロード制限（1リクエストあたりのサイズや処理時間の上限）に抵触しないよう、**クライアント側でファイルを分割（チャンク）し、サーバーに複数回に分けて送信**、サーバー側で**再結合**して保存します。ストレージは**自前サーバーディスクのみ**を使用し、Cloudflare R2 は使いません。ダウンロードは**署名つきリンク**で配布。実装は Docker 上で完結し、**フロントエンド：Node.js（Next.js 想定）／バックエンド：FastAPI**。

---

# 1. 目標と非目標
## 1.1 目標
- Cloudflare 経由でも Free プランの制限を踏まえて**安定して大容量ファイルをアップロード可能**にする（=1回の HTTP リクエストを小さく・短く保つ）。
- **中断・再開（resumable）**に対応。
- **自前ストレージ**（ローカルディスク、またはマウントされたブロックストレージ）に保存。
- **ダウンロードリンクの発行**（有効期限・ワンタイム/複数回・パスワード保護）。
- すべてを **Docker Compose** でデプロイ簡素化。

## 1.2 非目標
- Cloudflare R2や外部オブジェクトストレージの利用。
- ライブ動画配信やブラウザP2P転送。

---

# 2. 全体アーキテクチャ
```
[Browser/Front (Next.js)]
   |  HTTPS (via Cloudflare)
   v
[Cloudflare] --WAF/RateLimit--> [Nginx] --reverse proxy--> [FastAPI]
                                                |            \
                                                |             -> [Worker] (Celery/RQ)
                                                |                 ^
                                                v                 |
                                            [PostgreSQL] <---- [Redis]
                                                |
                                                v
                                         [/data volume]
```
- **Next.js**：UI、チャンク分割、並列送信、再試行・レジューム制御。
- **Nginx**：リバースプロキシ／大容量ダウンロードの送出（sendfile / X-Accel-Redirect）。
- **FastAPI**：API、認証、アップロードセッション管理、チャンク受信、検証、結合指示、署名URL発行。
- **Worker（Celery/RQ + Redis）**：結合・ハッシュ検証・（任意）ウイルススキャン・メタデータ確定を非同期化。
- **PostgreSQL**：メタデータ、セッション、リンク、監査ログ。
- **/data**：実ファイル・一時チャンク・再結合先の保存先（Docker ボリューム/ホストマウント）。

---

# 3. アップロード方式（クライアント主導の分割アップロード）
## 3.1 チャンク戦略
- **固定長チャンク**（例：8–16 MiB）を基本とし、回線・遅延に応じて**動的に縮小**可能（目安：1リクエストが短時間で完了するサイズ）。
- **並列送信**：同時 3–6 接続まで（ブラウザ制限とサーバ負荷のバランス）。
- **整合性**：各チャンクの SHA-256 を `X-Chunk-Checksum` として送信。ファイル全体の SHA-256 を最終確定時に送信。
- **レジューム**：セッションID単位でサーバが受領済みインデックスを返す → 未送信のみ再送。
- **冪等性**：`Idempotency-Key` ヘッダで同一チャンクの多重送信を無害化。

## 3.2 フロー（時系列）
1. **Init**：フロントが `/api/upload/sessions` を叩き、`upload_session_id` を取得。
2. **Probe**：`GET /api/upload/sessions/{id}` で受領済みインデックスを確認。
3. **PUT チャンク**：`/api/upload/sessions/{id}/chunk/{index}` にバイナリ送信（小さな Body）。
4. **Finalize**：`/finalize` に全体ハッシュ等を送信 → Worker が**再結合**・**全体ハッシュ検証**。
5. **Complete**：ファイルレコード作成、最終パスへ**アトミック rename**。
6. **Link 発行**：`/api/files/{file_id}/links` で署名つき URL を生成。

---

# 4. API 設計（FastAPI）
**凡例**：`{...}` はパラメータ、`[]` は任意。エラー時は JSON で `error.code` / `error.message`。

## 4.1 認証 & 共通
- 管理者/ログインユーザ向け API は **JWT**（HTTP-only Cookie or Bearer）。
- パブリックダウンロードは **署名トークン**で保護。
- CORS：フロントのオリジンのみ許可。`OPTIONS` 事前応答を許可。

## 4.2 エンドポイント一覧
### セッション
- **POST** `/api/upload/sessions`
  - Req: `{ filename, size, mime_type, chunk_size, total_chunks, file_sha256 }`
  - Res: `{ upload_session_id, accepted_chunk_size, expires_at }`
- **GET** `/api/upload/sessions/{id}`
  - Res: `{ received: number[], missing: number[], status }`
- **PUT** `/api/upload/sessions/{id}/chunk/{index}`
  - Headers: `Content-Type: application/octet-stream`
  - Headers: `X-Chunk-Size, X-Chunk-Checksum (sha256), Idempotency-Key`
  - Body: チャンクバイナリ
  - Res: `{ ok: true, index, stored_size }`
- **POST** `/api/upload/sessions/{id}/finalize`
  - Req: `{ file_sha256 }`
  - Res: `{ status: "processing" | "completed", file_id? }`

### ファイル & リンク
- **GET** `/api/files/{file_id}`（要認証）: メタデータ取得
- **DELETE** `/api/files/{file_id}`（要認証）: 削除（ソフト/ハード）
- **POST** `/api/files/{file_id}/links`（要認証）
  - Req: `{ expires_in_sec, one_time?: boolean, password?: string }`
  - Res: `{ url: "/d/{file_id}?token=..." , expires_at }`
- **GET** `/d/{file_id}`（パブリック）
  - Query: `token`, `dl=1`（強制ダウンロード）
  - 挙動: トークン検証 → パス/ヘッダ設定 → Nginx に **X-Accel-Redirect** or sendfile で委譲
  - Range 対応、`Content-Disposition`/`Content-Type` 設定

### 管理・補助
- **GET** `/api/healthz`（liveness） / `/api/readyz`（readiness）
- **GET** `/api/limits`（推奨チャンクサイズ・並列数の提示、環境により可変）

## 4.3 ステータスコード
- `200/201` 正常、`202`（最終処理中）、`400`（検証失敗）、`401/403`（認可）、`404`、`409`（重複/競合）、`413`（チャンクが大きすぎ）、`429`（Rate limit）、`5xx`。

---

# 5. データモデル（PostgreSQL）
```sql
-- users（必要なら）
users(id uuid pk, email text unique, password_hash text, created_at timestamptz, ...)

files(
  id uuid pk,
  owner_id uuid null,
  filename text,
  size bigint,
  mime_type text,
  sha256 char(64),
  status text check (status in ('active','deleted')), -- ソフトデリート
  storage_path text,         -- /data/files/<id>/data
  created_at timestamptz,
  finalized_at timestamptz
)

upload_sessions(
  id uuid pk,
  owner_id uuid null,
  filename text,
  size bigint,
  mime_type text,
  file_sha256 char(64),
  chunk_size int,
  total_chunks int,
  received_count int default 0,
  received_bitmap bytea null, -- 省メモリビットセット or JSONB 配列
  tmp_dir text,               -- /data/uploads/tmp/<id>
  status text check (status in ('init','uploading','finalizing','completed','expired','failed')),
  created_at timestamptz,
  expires_at timestamptz
)

chunks(
  session_id uuid,
  idx int,
  size int,
  sha256 char(64),
  stored boolean,
  primary key(session_id, idx)
)

download_links(
  id uuid pk,
  file_id uuid references files(id),
  token_hash char(64),       -- HMAC(token)
  expires_at timestamptz,
  one_time boolean default false,
  remaining int default 1,
  password_hash text null,
  created_at timestamptz
)

download_audit(
  id bigserial pk,
  file_id uuid,
  ip inet,
  user_agent text,
  succeeded boolean,
  at timestamptz
)
```

---

# 6. ストレージ設計
- ルート：`/data`
  - 一時：`/data/uploads/tmp/{upload_session_id}/{index}.part`
  - ワーク：`/data/uploads/work/{upload_session_id}.assembling`
  - 完了：`/data/files/{file_id}/data`
  - メタ：`/data/files/{file_id}/meta.json`
- 再結合は**ストリーム連結**（追記 or ランダムアクセス書き込み）で OOM を回避。
- 完了時は**fsync → アトミック rename**で整合性確保。
- （任意）**クォータ**：ユーザーごとの総容量/ファイルサイズ上限をテーブルで制御。

---

# 7. Cloudflare / Nginx 設計ポイント
- **/api/** へのリクエストはキャッシュしない（`Cache-Control: no-store`）。
- 認証/管理APIは WAF ルールで Bot/国制限、Rate limit を設定。
- **チャンクは小さく短時間で完了**する設計（ネットワークが遅い場合はクライアント側で自動縮小）。
- ダウンロード `/d/` は Range 対応、`ETag`/`Last-Modified` を返却。公開配布が前提なら Cloudflare でのキャッシュを許可（`Cache-Control: public, max-age=...`）。
- Nginx は `sendfile on;` `aio on;` を有効化、巨大ファイル転送を**アプリから切り離し**。
- `X-Accel-Redirect` を使い、FastAPI は権限チェックだけで I/O を持たない最小経路に。

---

# 8. セキュリティ & コンプライアンス
- 署名リンク：`token = base64url(JWT(file_id, exp), HMAC(secret))`。URL 露出に耐性。
- パスワード保護（PBKDF2/argon2 で保存）。
- **CSRF 対策**：同一サイト Cookie + CSRF トークン or Authorization Bearer。
- **Rate limiting**：IP/ユーザー/セッション単位でアップロード・ダウンロードを制限（Nginx + アプリ）。
- **入力検証**：ファイル名の正規化（パストラバーサル無効化）、MIME 推定。
- **ウイルススキャン（任意）**：ClamAV コンテナで完成後スキャン。隔離→管理UIで復旧/削除。
- **ログ/監査**：すべての finalize とダウンロード試行を監査表に記録。

---

# 9. 障害対応・リトライ・GC
- **Idempotency-Key**：同一チャンク重送を 200 で吸収。
- **Finalize 再試行**：最終ハッシュ不一致→`failed`、再開はセッション作り直し。
- **GC**：`expired` なセッションの `tmp` を cron（Worker）で削除。
- **クリーンアップ**：`SIGTERM` 受信時、進行中の結合をチェックポイント化（ワークファイル残し）。

---

# 10. パフォーマンス
- クライアント：帯域計測で**目標 30–60 秒/リクエスト**になるようチャンクサイズ自動調整。
- サーバ：チャンク書き込みは**ノーコピー**でディスク直書き、`uvicorn --workers=N` + `async` I/O。
- 結合：Worker で並列化、I/O スケジューラに優しい順序で連結。
- ダウンロード：Nginx から直接配信、HTTP/2、Range、`tcp_nodelay/reuseport`。

---

# 11. Docker & デプロイ
## 11.1 ディレクトリ
```
repo/
  frontend/     # Next.js
  backend/      # FastAPI app
  worker/       # Celery/RQ tasks
  nginx/
  docker-compose.yml
  .env
  data/         # 本番ではホスト/クラウドボリュームにマウント
```

## 11.2 docker-compose（サンプル・骨子）
```yaml
version: '3.9'
services:
  nginx:
    image: nginx:1.27
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - data:/data
    ports: ["80:80"]
    depends_on: [api]

  api:
    build: ./backend
    environment:
      - DATABASE_URL=postgresql+psycopg://app:pass@db:5432/app
      - REDIS_URL=redis://redis:6379/0
      - DATA_ROOT=/data
      - SIGNING_SECRET=change-me
    volumes:
      - data:/data
    expose: ["8000"]

  worker:
    build: ./worker
    environment:
      - DATABASE_URL=postgresql+psycopg://app:pass@db:5432/app
      - REDIS_URL=redis://redis:6379/0
      - DATA_ROOT=/data
      - SIGNING_SECRET=change-me
    volumes:
      - data:/data
    depends_on: [db, redis]

  frontend:
    build: ./frontend
    environment:
      - NEXT_PUBLIC_API_BASE=/api
    depends_on: [api]

  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=app
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7

volumes:
  data:
  pgdata:
```

## 11.3 Nginx（抜粋）
```nginx
user  nginx;
worker_processes auto;
error_log  /var/log/nginx/error.log warn;

http {
  sendfile on;
  tcp_nopush on;
  tcp_nodelay on;
  server_tokens off;

  upstream api_upstream { server api:8000; }

  server {
    listen 80;

    # API はキャッシュしない
    location /api/ {
      proxy_pass http://api_upstream;
      proxy_set_header Host $host;
      proxy_read_timeout 95s; # チャンクは短時間で終わる想定
      add_header Cache-Control "no-store";
    }

    # 署名済みダウンロードを内部転送
    location /_protected/ {
      internal;
      alias /data/files/; # /_protected/<file_id>/data に対応
    }

    location /d/ {
      proxy_pass http://api_upstream; # FastAPI がトークン検証し、X-Accel-Redirect を返す
    }

    # フロント（Next.js プロキシ or 静的配信）
    location / {
      proxy_pass http://frontend:3000;
    }
  }
}
```

---

# 12. バックエンド実装メモ（FastAPI）
- チャンク受信：`StreamingResponse` ではなく **request.body() をストリームで受領**し直接ファイルに追記。
- 受領先：`/data/uploads/tmp/{session}/{index}.part`。
- finalize：Worker ジョブ投入 → 1..N の `.part` を順に結合 → `sha256sum` 検証 → `/data/files/{file_id}/data` へ rename。
- ダウンロード：`/d/{file_id}` はトークン検証後、`X-Accel-Redirect: /_protected/{file_id}/data` を返却。

---

# 13. フロント実装メモ（Next.js）
- `File`/`Blob.slice()` でチャンク化。
- **並列送信キュー**（最大 4–6）。
- **指数バックオフ**でリトライ、`Idempotency-Key` に `sessionId-index-random`。
- `GET /sessions/{id}` の `missing` を見て再送。
- 進捗 UI：受領済みカウント/総数、推定残り時間。
- Finalize 完了後、署名リンク作成ボタンを提示。

---

# 14. 監視・可観測性
- Prometheus メトリクス：`chunks_received_total`,`chunk_bytes_total`,`finalize_duration_seconds`,`active_sessions` 等。
- アプリログ：JSON 構造化、`session_id`/`file_id` 相関 ID を必ず出す。
- ディスク監視：空き容量閾値でアップロード停止（`503` + 明示エラー）。

---

# 15. テスト計画
- 単体：チャンク検証、ハッシュ不一致、重複送信の冪等性。
- 疎通：1GB 以上のファイルを 8–16MiB チャンクで並列アップロード。
- ネットワーク悪条件（帯域/遅延/切断）：開発ツールでスロットル、チャンク縮小が機能するか。
- 中断→再開、Finalize 中のクラッシュ→再起動時のリカバリ。
- 署名リンク：期限切れ、1回限り、パスワード保護、Range 取得。

---

# 16. 移行・スケールアウト
- 単一ノード → 複数APIに水平展開する場合：
  - 共通 `/data` を **共有ボリューム**（NFS/分散FS）に、または「チャンク受領ノード = 結合担当ノード」のキュー設計。
  - sticky session 不要（セッション状態は DB/Redis へ）。
- Edge キャッシュを強める場合は `/d/` のキャッシュヘッダを積極設定（公開可のファイルのみ）。

---

# 17. セキュリティ・プライバシーの補足
- PII/機密の取り扱いはデフォルト非公開。URL を知っているだけでは取得できない構造（必ず署名トークン）。
- at-rest 暗号化（任意）：`dm-crypt` や ZFS 暗号化、またはファイル単位 AES（鍵管理が必要）。

---

# 18. 参考エラーレスポンス（例）
```json
{
  "error": {
    "code": "CHUNK_TOO_LARGE",
    "message": "Chunk size exceeds server policy. Reduce below 16MiB."
  }
}
```

---

# 19. 今後の拡張
- **TUS プロトコル互換**API を追加（既存クライアント資産を活用）。
- 重複排除（同一ハッシュの既存ファイルをハードリンク / リファレンス）。
- Webhook / Zapier 連携でアップロード完了通知。

---

# 付録 A：最小スキーマ（Pydantic）
```python
class CreateSession(BaseModel):
    filename: str
    size: int
    mime_type: str | None = None
    chunk_size: int
    total_chunks: int
    file_sha256: str

class SessionStatus(BaseModel):
    received: list[int]
    missing: list[int]
    status: Literal['init','uploading','finalizing','completed','expired','failed']
```

---

# 付録 B：署名トークン（擬似）
- `payload = {file_id, exp, nbf, iat, one_time}` を HS256 で署名。
- 受信時：`exp/nbf` 検証、`one_time` は DB の `remaining` をデクリメント。

---

# 付録 C：クライアント擬似コード
```ts
async function upload(file: File, opts) {
  const chunkSize = pickChunkSize();
  const total = Math.ceil(file.size / chunkSize);
  const { id } = await createSession({ filename: file.name, size: file.size, chunk_size: chunkSize, total_chunks: total, file_sha256: await sha256(file) });

  let missing = await getMissing(id);
  const pool = new Pool(4);

  for (const i of missing) {
    const blob = file.slice(i*chunkSize, Math.min((i+1)*chunkSize, file.size));
    pool.run(() => putChunk(id, i, blob, checksum(blob)));
  }
  await pool.drain();
  await finalize(id);
}
```

