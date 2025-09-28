# ShareFile

ShareFile は Cloudflare Free プランの制限を回避しつつ、大容量ファイルをチャンク分割してアップロード・再結合・署名付きダウンロードリンクを提供するストレージアプリです。Next.js フロントエンド、FastAPI バックエンド、Celery ワーカー、PostgreSQL、Redis、Nginx を Docker Compose でまとめて起動できます。

## 必要要件
- Docker / Docker Compose

## クイックスタート
Docker Compose プロジェクトを初回起動する際は `docker compose up` に `--build` オプションを付けて実行してください。

起動後の主要エンドポイント:
- フロントエンド: http://localhost:8082
- API: http://localhost:8082/api
- ダウンロード: http://localhost:8082/d/<file_id>?token=...

デフォルトの管理者資格情報:
- ユーザー: `admin@example.com`
- パスワード: `changeme`

`.env` では `ADMIN_PASSWORD` に平文パスワードを指定するだけで利用可能です（ハッシュへ自動変換）。既存の bcrypt ハッシュを使いたい場合は `ADMIN_PASSWORD_HASH` に直接設定してください。

一般ユーザーはログイン画面の「新規アカウント登録」から仮登録でき、管理者が承認するとログイン可能になります。

## アーキテクチャ概要
- **Next.js** (`frontend/`): ブラウザ上でファイルを固定サイズチャンクへ分割し、並列アップロード・レジューム・Finalize を実行。
- **FastAPI** (`backend/`): アップロードセッション管理、チャンク受信、セッション状態照会、Finalize、ダウンロードリンク発行。
- **Celery Worker**: チャンク再結合と SHA-256 検証を非同期実行し、成功時に `/data/files/<file_id>/data` へ配置。
- **PostgreSQL / Redis**: メタデータ永続化とジョブキュー。
- **Nginx**: `/api` と `/d/` を FastAPI へリバースプロキシし、`X-Accel-Redirect` による大容量ダウンロード最適化を担当。

## 主要フロー
1. フロントエンドがアップロードセッション (`POST /api/upload/sessions`) を作成。
2. `PUT /api/upload/sessions/{id}/chunk/{index}` でチャンクを並列送信し、`X-Chunk-Checksum` と `Idempotency-Key` を付与。
3. `POST /api/upload/sessions/{id}/finalize` で再結合ジョブを投入。
4. Celery ワーカーがチャンクを結合・ハッシュ検証し、ファイルを確定。
5. `POST /api/files/{file_id}/links` で署名付きリンクを作成し、`GET /d/{file_id}?token=...` でダウンロード。

## 開発メモ
- バックエンド依存関係: `backend/requirements.txt`
- フロントエンド依存関係: `frontend/package.json`
- ストレージボリューム: コンテナ内は `/data/uploads/tmp/<session_id>` / `/data/files/<file_id>/data`。ホスト側ではリポジトリ直下の `Storage/` に同期され、`Storage/files/<file_id>/data` に完成ファイルが配置されます。

## ユーザーと認可
- 管理者アカウント（`.env` の `ADMIN_EMAIL`）でログインすると以下が可能です:
  - 一般ユーザーの承認 / 無効化
  - 容量上限（バイト単位）の設定
  - パスワードリセット・ユーザー削除
  - すべてのファイルの閲覧・削除
- 一般ユーザーは承認後、自身のファイルのみアップロード/管理ができます。

## UI の主な使い方
- **プログレスバー**: アップロード完了（チャンク送信 + ワーカーによる結合）まで進捗率を表示します。
- **ダウンロードリンク発行**: 結合完了後まではボタンが無効化され、完了時に発行可能になります。
- **ファイル管理パネル**: アップロード済みファイルの一覧表示、リンクの作成・削除、ファイル削除が可能です。各リンクにはダウンロードされた回数が表示されます。
- **管理者パネル**: ユーザー一覧、承認、削除、容量上限設定、管理者の追加が可能です。
- Celery ワーカー起動コマンド: `celery -A app.worker.celery_app worker --loglevel=info`
- 必要に応じて `CORS_ALLOWED_ORIGINS` 環境変数で許可オリジンを制限。

## 今後の拡張
- 一般ユーザーが自身のアカウントのパスワードを変更できるようにする
- リンクの有効期限を日付け or 無制限で設定できるようにする
- ライトモード/ダークモードの切り替え追加
- ダウンロードURLをボタンでコピー出来るようにする。
- ログイン状態を一定期間保存する

