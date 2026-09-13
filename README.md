# CapsuleCrush

恋人の「好きなところ」を1つずつテキストでカプセルに詰めて、ガシャポンに貯めていくアプリです。
自分専用のガシャポンを回すと、貯めたカプセルの中から1つがランダムに出てきます。

## 技術構成

- Cloudflare Workers + [Hono](https://hono.dev/)
- Cloudflare D1（データ保存）
- Cloudflare R2（画像保存、任意）
- フロントエンド: 素のHTML/CSS/JS（ビルド不要）
- 認証: ユーザー名 + パスコードの簡易認証（トークンベース）

## セットアップ

```bash
npm install
```

`wrangler.toml` の `database_id` を自分の D1 データベース ID に置き換えてください。

```bash
npm run db:init:local   # ローカルDBにスキーマ適用
npm run dev              # ローカル開発サーバー
```

## デプロイ

```bash
npm run db:init          # 本番D1にスキーマ適用（初回のみ）
npm run deploy
```

## データモデル

- `users`: id, username(unique), passcode_hash, created_at
- `capsules`: id, user_id, text, memo_date, image_key, created_at, updated_at
- `sessions`: token, user_id, created_at
