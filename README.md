# web-cam

Three.js の duck モデルをカメラ映像に重ねて撮影・保存する最小 Web アプリです。

## セットアップ

```bash
make install
```

## ローカル起動

```bash
make dev
```

ブラウザで `http://localhost:5173` を開きます。

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
