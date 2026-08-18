# web-cam

Three.js の duck モデルをカメラ映像に重ねて撮影・保存する Web アプリです。

フロントエンドは `frontend/`、Tripo API と Vercel Blob を扱うバックエンドは
`backend/` に分離しています。

## セットアップ

```bash
cp backend/.env.example backend/.env
make install
```

## ローカル起動

```bash
make dev
```

ブラウザで `http://localhost:5173` を開きます。

バックエンド API は別ターミナルで起動します。

```bash
make backend
```

`backend/.env` に `TRIPO_API_KEY` と `BLOB_READ_WRITE_TOKEN` を設定してください。

## Docker 実行

```bash
make docker
```

ブラウザで `http://localhost:5173` を開きます。

## スマホ確認

スマホのカメラ起動には HTTPS が必要です。Cloudflare Tunnel 経由で起動します。

```bash
make docker-tunnel
```

ログに出る `https://...trycloudflare.com` の URL をスマホで開きます。
Vite の Host 制限に合わせて `*.trycloudflare.com` は許可済みです。

## Vercel デプロイ

Vercel Servicesを使い、1つのVercelプロジェクト内でfrontendとbackendを動かします。
リポジトリのルートをRoot Directoryにし、Frameworkを`Services`に設定してください。
ルートの`vercel.json`が`/api/*`をbackend、それ以外をfrontendへルーティングします。

Backendで使う環境変数を同じVercelプロジェクトに設定します。

- `TRIPO_API_KEY`
- `BLOB_READ_WRITE_TOKEN`
- `FRONTEND_ORIGIN`（Servicesでは通常不要）

Blob StoreはVercel DashboardのStorageから同じプロジェクト内に作成します。
保存後に返るGLBや画像のURLは、Vercel本体とは別のBlob配信URLになります。

```bash
vercel link
vercel blob create-store web-cam-models --access public
vercel --prod
```

```bash
cd backend
vercel link
vercel blob create-store web-cam-models --access public
```

## 操作

1. `カメラ起動` を押す
2. カメラ許可を出す
3. `撮影` を押す
4. `保存` を押して画像を保存する

## よく使うコマンド

```bash
make check
make build
make audit
make stop
make clean
```
