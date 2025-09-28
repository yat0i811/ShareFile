# ShareFile Docker コマンド集

このドキュメントでは、ShareFileプロジェクトのDockerコンテナに関する主要なコマンドをまとめています。

## 🚀 基本的な起動・停止コマンド

### 初回起動（ビルドとコンテナ作成）
```bash
docker-compose up --build
```

### バックグラウンドで起動
```bash
docker-compose up -d
```

### バックグラウンドで起動（ビルド付き）
```bash
docker-compose up -d --build
```

### 停止
```bash
docker-compose down
```

### 停止（ボリューム削除）
```bash
docker-compose down -v
```

### 停止（イメージも削除）
```bash
docker-compose down --rmi all
```

## 🛠️ 開発用コマンド

### 特定のサービスのみ起動
```bash
# データベースのみ起動
docker-compose up db

# バックエンドのみ起動
docker-compose up backend

# フロントエンドのみ起動
docker-compose up frontend
```

### 特定のサービスのみビルド
```bash
# バックエンドのみビルド
docker-compose build backend

# フロントエンドのみビルド
docker-compose build frontend
```

### ログの確認
```bash
# 全サービスのログ
docker-compose logs

# 特定のサービスのログ
docker-compose logs backend
docker-compose logs frontend
docker-compose logs db

# リアルタイムでログを表示
docker-compose logs -f

# 特定のサービスのリアルタイムログ
docker-compose logs -f backend
```

## 🔧 メンテナンス・デバッグ用コマンド

### コンテナの状態確認
```bash
docker-compose ps
```

### サービスの詳細情報
```bash
docker-compose ps -a
```

### コンテナ内でコマンド実行
```bash
# バックエンドコンテナでbashを実行
docker-compose exec backend bash

# データベースに接続
docker-compose exec db psql -U share_storage -d share_storage

# Redisに接続
docker-compose exec redis redis-cli
```

### ヘルスチェック確認
```bash
# データベースの健康状態確認
docker-compose exec db pg_isready -U share_storage

# Redisの健康状態確認
docker-compose exec redis redis-cli ping
```

## 🧹 クリーンアップコマンド

### 使用していないDockerリソースを削除
```bash
# 使用していないコンテナ、ネットワーク、イメージを削除
docker system prune

# ボリュームも含めて削除
docker system prune -a --volumes
```

### ShareFile関連の削除
```bash
# ShareFileのコンテナとネットワークを削除
docker-compose down

# ShareFileのイメージも削除
docker-compose down --rmi all

# データベースのボリュームも削除（データ消失注意！）
docker-compose down -v
```

### 個別削除
```bash
# 停止したコンテナを削除
docker container prune

# 使用していないイメージを削除
docker image prune

# 使用していないボリュームを削除
docker volume prune

# 使用していないネットワークを削除
docker network prune
```

## 📊 モニタリング・統計コマンド

### リソース使用量の確認
```bash
# 実行中のコンテナのリソース使用量
docker stats

# ShareFileコンテナのみ
docker stats $(docker-compose ps -q)
```

### ディスク使用量
```bash
# Dockerが使用しているディスク容量
docker system df

# 詳細表示
docker system df -v
```

## 🔄 リスタート・再起動コマンド

### サービスの再起動
```bash
# 全サービス再起動
docker-compose restart

# 特定のサービス再起動
docker-compose restart backend
docker-compose restart frontend
docker-compose restart db
```

### 設定変更後の反映
```bash
# docker-compose.ymlの変更を反映
docker-compose up -d --remove-orphans

# 強制的に再作成
docker-compose up -d --force-recreate
```

## 🗂️ バックアップ・リストア

### データベースバックアップ
```bash
# PostgreSQLデータをバックアップ
docker-compose exec db pg_dump -U share_storage share_storage > backup_$(date +%Y%m%d_%H%M%S).sql
```

### データベースリストア
```bash
# バックアップからリストア
docker-compose exec -T db psql -U share_storage -d share_storage < backup_YYYYMMDD_HHMMSS.sql
```

### ストレージディレクトリのバックアップ
```bash
# Storageディレクトリをバックアップ
tar -czf storage_backup_$(date +%Y%m%d_%H%M%S).tar.gz ./Storage/
```

## 🌐 アクセス情報

- **アプリケーション**: http://localhost:8080
- **API**: http://localhost:8080/api
- **データベース**: localhost:5432
  - ユーザー: `share_storage`
  - パスワード: `share_storage`
  - データベース名: `share_storage`
- **Redis**: localhost:6379

## ⚠️ トラブルシューティング

### ポート競合の解決
```bash
# ポート使用状況確認（Windows）
netstat -an | findstr :8080
netstat -an | findstr :5432

# ポート使用状況確認（Linux/Mac）
lsof -i :8080
lsof -i :5432
```

### 完全な初期化
```bash
# 全てのコンテナ、イメージ、ボリュームを削除して初期化
docker-compose down -v --rmi all
docker-compose up --build
```

### キャッシュクリア付きビルド
```bash
# Dockerビルドキャッシュをクリアしてビルド
docker-compose build --no-cache
docker-compose up -d
```

## 📝 よく使うコマンドの組み合わせ

### 開発時の起動手順
```bash
# 1. 最新の設定でコンテナを起動
docker-compose up -d --build

# 2. ログを監視
docker-compose logs -f

# 3. 問題があれば再起動
docker-compose restart backend
```

### メンテナンス手順
```bash
# 1. データベースのバックアップ
docker-compose exec db pg_dump -U share_storage share_storage > backup.sql

# 2. コンテナ停止
docker-compose down

# 3. アップデート後起動
docker-compose up -d --build

# 4. 動作確認
docker-compose logs backend
docker-compose ps
```

このコマンド集を参考に、効率的にShareFileの開発・運用を行ってください。