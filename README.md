# Price & BE ROAS Dashboard

Interactive calculator for ecommerce pricing and breakeven ROAS, factoring in COGS, rebill cycles, stick rate, chargebacks, refunds, transaction fees, and pre-alert costs.

## Local development

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Build

```bash
npm run build
npm start
```

`npm start` serves the built `dist/` folder on `$PORT` (defaults to 3000).

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway, click **New Project → Deploy from GitHub repo** and pick this repo.
3. Railway auto-detects Node, runs `npm install`, then `npm run build` (via the postinstall-style build step — see below) and finally `npm start`.
4. If Railway doesn't run the build automatically, set the **Build Command** to `npm run build` and the **Start Command** to `npm start` in the service settings.
5. Railway provides `$PORT` automatically; the `start` script binds to it.

That's it — no Dockerfile required.
