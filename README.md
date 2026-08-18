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

ローカルfrontend/backendを起動し、Blobだけ本番Vercelへ接続する標準手順は次です。

```bash
make dev-tunnel
```

このコマンドはDevelopment環境のVercel環境変数を取得し、ローカルbackendへ渡します。
`backend/.env`には`TRIPO_API_KEY`だけを設定します。

Tunnelなしでローカル確認する場合は次を使います。

```bash
make dev
```

停止は別ターミナルから実行できます。

```bash
make stop
```

ログに出る `https://...trycloudflare.com` の URL をスマホで開きます。
Vite の Host 制限に合わせて `*.trycloudflare.com` は許可済みです。

## Vercel デプロイ

このリポジトリは、Vercel Servicesで1つのプロジェクトにまとめてデプロイします。
ルートの`vercel.json`が、`/api/*`をbackend、それ以外をfrontendへルーティングします。

### 新規プロジェクトの作成

1. Vercelの`New Project`で`k4nkan/web-cam`をImportする
2. Root Directoryはリポジトリのルート（`.`）にする
3. Framework Presetを`Services`にする
4. Build Command、Output Directory、Install Commandは上書きしない
5. Production Branchを`main`にしてDeployする

`Services`がFramework Presetに表示されない場合は、Servicesの利用権限がアカウントにないか、
プロジェクト側がServicesになっていません。`vercel.json`を書くだけではServicesとして動きません。

### Blobの作成

Deploy後、同じプロジェクトの`Storage`→`Create Database`→`Blob`からPublic Blob Storeを作成します。
新しいBlob StoreではOIDC接続が使われ、`BLOB_STORE_ID`などが自動追加されます。
ローカル開発では`make dev`または`make dev-tunnel`がDevelopment環境のOIDC変数を取得します。

生成済みGLB・プレビュー画像はBlobのURLで配信されます。VercelプロジェクトのURLとBlob配信URLは別です。

### 環境変数

Vercelの`Settings`→`Environment Variables`で、少なくともProductionに以下を設定します。

- `TRIPO_API_KEY`：TripoのAPIキー
- `TRIPO_MODEL`：任意。未設定時はバックエンドの既定値を使う
- `TRIPO_API_BASE_URL`：任意。未設定時はTripo v3 APIを使う

### CLIでの確認・デプロイ

ローカルのVercel CLIは最新にしてから、リポジトリルートで実行します。

```bash
npm i -g vercel@latest
vercel link
vercel build --prod
vercel deploy --prebuilt --prod
```

Git連携済みなら、`main`へpushして自動デプロイする運用で問題ありません。
`backend/`へ移動して別プロジェクトとして`vercel`を実行しないでください。

### デプロイ後の確認

```bash
curl -i https://<project-domain>/api/health
curl -i https://<project-domain>/api/models
```

`/api/health`が`{"ok":true}`を返し、`/api/models`がBlob未設定なら明確な環境変数エラーを返すことを確認します。

## 操作

1. `カメラ起動` を押す
2. カメラ許可を出す
3. `撮影` を押す
4. `保存` を押して画像を保存する

## よく使うコマンド

```bash
make install
make dev
make dev-tunnel
make stop
```
