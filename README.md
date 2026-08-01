# Duck Camera

Three.js で duck の 3D モデルをカメラ映像に重ね、撮影した画像を保存する最小構成の Web アプリです。

## ローカル実行

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

## Docker 実行

```bash
docker compose up --build app
```

ブラウザで `http://localhost:5173` を開きます。

## スマホ確認

スマホのカメラ起動には HTTPS が必要です。Cloudflare Tunnel 付きで起動します。

```bash
docker compose --profile tunnel up --build
```

ログに出る `https://...trycloudflare.com` の URL をスマホで開きます。

## 操作

1. `カメラ起動` を押す
2. カメラ許可を出す
3. `撮影` を押す
4. `保存` を押して画像を保存する
