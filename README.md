# web-cam

カメラ映像に3Dモデルを重ねて撮影し、画像から新しいモデルを生成するWebアプリです。

## 構成

```text
frontend/  Vite + Three.js
  ├─ カメラ撮影
  ├─ モデル選択・3Dプレビュー
  └─ /api をローカルbackendへproxy

backend/   Node.js + Vercel Functions
  ├─ Tripo API連携
  ├─ Vercel Blobへの画像・モデル保存
  └─ 非同期タスクの作成・状態確認

Vercel Services
  ├─ /api/*  → backend
  └─ その他  → frontend
```

モデル本体はVercel Blobに保存します。アヒルのFBXはbackendから初回アクセス時にBlobへ保存されます。

## 技術スタック

- Frontend: JavaScript, Vite, Three.js
- Backend: Node.js, Vercel Functions
- 3D生成: Tripo API
- Storage: Vercel Blob（OIDC）
- Mobile camera: `getUserMedia`
- Tunnel: Cloudflare Quick Tunnel

## データフロー

```text
画像アップロード / 撮影
  → backend `/api/models`
  → Blobへ元画像を保存
  → Tripoへモデル生成依頼
  → frontendが `/api/task` をポーリング
  → 生成済みモデルをBlobへ保存
  → `/api/models` から選択・プレビュー
```

## セットアップ

```bash
cp backend/.env.example backend/.env
# backend/.env に TRIPO_API_KEY を設定
make install
```

## コマンド

```bash
make dev          # ローカルfrontend/backendを起動
make dev-tunnel   # 上記＋Cloudflare Tunnelを起動
make stop         # ローカルfrontend/backend/Tunnelを停止
```

`make dev` と `make dev-tunnel` は、VercelのDevelopment環境からOIDC用の環境変数を取得します。
Blob Store AccessでDevelopment環境を有効にしてください。

スマートフォンでカメラを使う場合は、`make dev-tunnel` のURLを開きます。

## デプロイ

`main`へのpushで、Vercel Servicesのfrontend/backendが自動デプロイされます。
