# Aeonian — Gamified DeFi Perpetuals Trading on Solana

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Platform: Android](https://img.shields.io/badge/Platform-Android-green.svg)](https://aeonian.arena)
[![Chain: Solana](https://img.shields.io/badge/Chain-Solana-9945FF.svg)](https://solana.com)

**Aeonian** is a mobile-first crypto perpetual futures trading app on Solana. It transforms on-chain trading into a competitive social sport through real-money 1v1 Battles, Royal Rumbles, monthly Prize Pots, and a Points Rewards system — all settled on-chain in USDC.

> Currently in **Beta** — Android APK v1.0.3. Desktop shows a block screen by design.

---

## Why Aeonian?

Most DEX interfaces are utilitarian dashboards. Aeonian layers competitive, social, and gamified mechanics directly on top of live perps trading — turning every trade into a potential battle, every win into a shareable moment, and every month into a leaderboard race for real prizes.

---

## Features

### Trade
- Perpetual futures on Solana — long/short with up to 15x leverage
- Cross-margin and Isolated margin modes
- Market and limit orders with Take Profit / Stop Loss
- Real-time price charts, orderbook, and live position tracking
- Multi-market symbol picker (crypto, commodities) with favorites
- Isolated Sweep — auto-sweep isolated profits back to cross margin

### Arena / Battles
- **1v1 Battles** — head-to-head PnL% competition with USDC wagers; open or targeted challenges
- **Royal Rumble** — multi-player entry-fee competition; top 3 by PnL% split the prize pot
- **Monthly Leaderboard** — rolling Daily / Weekly / Monthly / All-Time PnL rankings
- **Monthly Prize Pot** — community pool paid out to top performers (50% / 35% / 15%)
- In-battle trash talk, spectators, live countdown, and shareable result cards
- Hall of Fame — historical archive of monthly prize pot winners

### Portfolio
- Full portfolio view: collateral, unrealized PnL, available cash, funding costs
- Deposit / Withdraw USDC or SOL
- Token swap via Jupiter aggregator (best-route across Solana DEXes)
- Native SOL send and PnL history chart
- Share open positions and PnL as branded image cards

### Rewards
- Points system across Trading, Battle, and Social categories
- Social rewards: follow on X, join group chat, post branded promotions
- Approve/reject promotion submissions tracked on-chain

### Social / Identity
- Link your X/Twitter account to your Solana wallet
- X handle and avatar shown across battles, leaderboards, and profiles
- Follow other traders, in-app notifications, live wins ticker

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Hono on Cloudflare Workers |
| Database | Tarobase (real-time subscriptions) |
| Auth | Solana wallet (Phantom / Privy embedded wallet) + AWS Cognito JWT |
| On-chain | Solana mainnet, USDC (SPL), Jupiter aggregator |
| Distribution | Android APK (sideload); no App Store listing yet |

---

## Architecture

```
Mobile App (React/Vite PWA → Android APK)
        │
        ├── Solana Perps SDK   ──► Solana mainnet (on-chain trades, positions)
        ├── Jupiter API        ──► Token swaps
        ├── Privy / Phantom    ──► Wallet auth
        │
        └── Hono API (Cloudflare Workers)
                │
                ├── Tarobase (real-time DB — leaderboards, battles, rewards)
                ├── AWS Cognito (JWT auth)
                └── Battle settlement (USDC wager escrow + on-chain payout)
```

---

## Getting Started (Local Development)

### Prerequisites
- [Bun](https://bun.sh) v1.1.42+
- A Solana RPC endpoint (e.g. [Helius](https://helius.dev))
- A [Tarobase](https://tarobase.com) app

### Frontend

```bash
# Install dependencies
bun install

# Copy env vars and fill in your values
cp .env.example .env

# Start dev server
bun dev --port 3000
```

### Backend (Cloudflare Worker)

```bash
cd partyserver

# Install dependencies
bun install

# Copy wrangler config template and fill in your values
cp wrangler.toml.template wrangler.toml

# Run locally
bun run dev

# Deploy
bun run deploy
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list of required frontend variables.

For the backend, copy `partyserver/wrangler.toml.template` to `partyserver/wrangler.toml` and fill in:
- `account_id` — your Cloudflare account ID
- `TAROBASE_APP_ID` — your Tarobase app ID
- `JWT_ISSUER` — your AWS Cognito user pool URL

---

## License

[MIT](LICENSE) — open source, free to fork and build on.

---

## Links

- **Download APK**: [aeonian.arena](https://aeonian.arena) *(Android, sideload)*
- **Twitter / X**: [@Aeonian_Arena](https://x.com/Aeonian_Arena)
- **Built on**: [Solana](https://solana.com)
- **Supported by**: [SuperteamMY](https://my.superteam.fun)
