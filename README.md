# ShareFile

大容量ファイルのチャンク分割アップロード・ダウンロード機能を提供するWebアプリケーションです。Cloudflare Free プランの制限に対応し、ファイルを小さく分割してアップロードすることで安定した大容量ファイル転送を実現します。

## 主な機能

- **チャンク分割アップロード**: 大容量ファイルを小さなチャンクに分割して並列アップロード
- **中断・再開機能**: アップロードが中断されても再開可能
- **ユーザー認証・管理**: JWT認証によるユーザー管理
- **セキュアなダウンロード**: 署名付きURL、期限・パスワード設定
- **管理者機能**: ユーザー管理、ファイル管理
- **レスポンシブUI**: ダーク/ライトテーマ対応

## 技術スタック

### バックエンド
- **FastAPI**: 高速なPython Web API フレームワーク
- **PostgreSQL**: メインデータベース
- **Redis**: セッション管理・非同期タスクキュー
- **Celery**: 非同期ワーカー（ファイル結合処理）
- **SQLAlchemy**: ORM
- **Alembic**: データベースマイグレーション

### フロントエンド
- **Next.js 14**: React フレームワーク
- **TypeScript**: 型安全な開発
- **CSS Modules**: スタイリング

### インフラ
- **Docker & Docker Compose**: コンテナ化デプロイ
- **Nginx**: リバースプロキシ・静的ファイル配信
- **ローカルストレージ**: ファイル保存

## 前提条件

- Docker
- Docker Compose
- Git

## セットアップ・起動手順

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd ShareFile
```

### 2. 環境変数の設定

`.env` ファイルを作成し、必要な環境変数を設定します：

```bash
# データベース設定
DATABASE_URL=postgresql+asyncpg://share_storage:share_storage@db:5432/share_storage

# Redis設定
REDIS_URL=redis://redis:6379/0

# JWT設定
JWT_SECRET=your-super-secret-jwt-key-change-this

# ストレージ設定
STORAGE_ROOT=/data

# アプリケーション設定
PROJECT_NAME=ShareFile
CORS_ALLOWED_ORIGINS=["http://localhost:8082"]

# 管理者設定
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
```

### 3. Docker Composeでアプリケーションを起動

```bash
# Windows
start.bat

# または手動実行
docker-compose up --build
```

### 4. アプリケーションにアクセス

ブラウザで `http://localhost:8082` にアクセスします。

## 使用方法

### 初回ログイン

管理者アカウントでログイン：
- Email: `admin@example.com`
- Password: `admin123`

### ファイルアップロード

1. **ファイル選択**: アップロードするファイルを選択
2. **チャンクサイズ設定**: デフォルト8MBから調整可能
3. **アップロード開始**: 自動的にファイルを分割して並列アップロード
4. **進行状況確認**: リアルタイムで進捗を確認
5. **完了**: アップロード完了後、ダウンロードリンクを生成

### ダウンロードリンク作成

- **有効期限**: 1時間〜永続まで設定可能
- **アクセス制限**: ワンタイム/複数回アクセス
- **パスワード保護**: オプションでパスワード設定
- **専用ページ**: ダウンロード専用ページの生成

## API仕様

### 認証

```
POST /api/auth/login
POST /api/auth/register
```

### アップロード

```
POST /api/upload/sessions          # セッション作成
GET /api/upload/sessions/{id}      # セッション状態確認
PUT /api/upload/sessions/{id}/chunk/{index}  # チャンクアップロード
POST /api/upload/sessions/{id}/finalize     # アップロード完了
```

### ファイル管理

```
GET /api/files                     # ファイル一覧
GET /api/files/{id}               # ファイル詳細
DELETE /api/files/{id}            # ファイル削除
POST /api/files/{id}/links        # ダウンロードリンク作成
```

### ダウンロード

```
GET /d/{file_id}?token=...        # ファイルダウンロード
GET /s/{file_id}?token=...        # 専用ダウンロードページ
```

## プロジェクト構造

```
ShareFile/
├── backend/                 # FastAPI バックエンド
│   ├── app/
│   │   ├── api/            # API ルート
│   │   ├── core/           # 設定・認証
│   │   ├── db/             # データベース
│   │   ├── models/         # SQLAlchemyモデル
│   │   ├── schemas/        # Pydanticスキーマ
│   │   ├── services/       # ビジネスロジック
│   │   └── utils/          # ユーティリティ
│   ├── celery_worker.py    # Celeryワーカー
│   └── requirements.txt
├── frontend/               # Next.js フロントエンド
│   ├── app/               # ページルート
│   ├── components/        # Reactコンポーネント
│   └── lib/              # ユーティリティ
├── nginx/                 # Nginx設定
├── Storage/              # ファイルストレージ
├── docker-compose.yml    # Docker構成
└── start.bat            # 起動スクリプト
```

## 開発・運用

### ログ確認

```bash
# 全サービスのログ
docker-compose logs -f

# 特定サービス
docker-compose logs -f backend
docker-compose logs -f worker
```

### データベース管理

```bash
# マイグレーション実行
docker-compose exec backend alembic upgrade head

# マイグレーション作成
docker-compose exec backend alembic revision --autogenerate -m "description"
```

### ストレージ管理

アップロードされたファイルは `./Storage` ディレクトリに保存されます：

```
Storage/
├── files/           # 完成ファイル
├── uploads/         # アップロード中ファイル
└── tmp/            # 一時ファイル
```

### パフォーマンス設定

**チャンクサイズ調整**:
- 高速回線: 16MB以上
- 通常回線: 8MB（デフォルト）
- 低速回線: 2MB以下

**並列アップロード数**: 最大4並列（デフォルト）

### ディスク使用量

定期的に `./Storage` ディレクトリの使用量を確認してください。

## セキュリティ

- **JWT認証**: セキュアなユーザー認証
- **CORS設定**: オリジン制限
- **ファイル検証**: SHA256チェックサム
- **署名付きURL**: セキュアなダウンロード
- **Rate Limiting**: API呼び出し制限

## 制限事項

- **ファイルサイズ**: デフォルト制限なし（ディスク容量依存）
- **チャンクサイズ**: 最大20MB
- **同時アップロード**: ユーザーあたり制限あり
- **ストレージ**: ローカルディスクのみ

## コントリビューション

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/AmazingFeature`)
3. 変更をコミット (`git commit -m 'Add some AmazingFeature'`)
4. ブランチにプッシュ (`git push origin feature/AmazingFeature`)
5. プルリクエストを作成

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルを参照してください。

## サポート

問題や質問がある場合は、GitHubのIssuesページで報告してください。

---

**ShareFile** - Cloudflare対応の大容量ファイル転送システム
