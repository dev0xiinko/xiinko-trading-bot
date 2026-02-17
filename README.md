# 0xiinko v1.0.0 - Trading Bot

A tile-based web trading dashboard with an automatic trading bot using the OKX API. Supports both **Demo Trading** (paper trading) and **Live Trading** with perpetual contracts.

## ⚠️ Warning

**This bot trades with REAL MONEY when in LIVE mode!**

- Always start with DEMO mode to test your strategy
- Use at your own risk
- Never invest more than you can afford to lose
- Past performance does not guarantee future results

## Features

- **Demo Trading**: Test strategies with OKX's demo environment (no real money)
- **Live Trading**: Execute real trades on OKX (perpetual contracts)
- **Multi-Pair Support**: Trade BTC, ETH, SOL, XRP, DOGE, ADA simultaneously
- **Perpetual Contracts**: USDT-margined futures with configurable leverage (1x-125x)
- **MA Crossover Strategy**: 9-period vs 21-period moving average crossover
- **Real-time Dashboard**: Terminal-style UI with live price updates
- **Trade Configuration**: Adjustable trade size (USDT) and leverage
- **Position Tracking**: Real-time P&L with leverage calculation
- **Trade History**: Complete log of all executed trades

## Tech Stack

- Next.js 14 (App Router)
- JavaScript (no TypeScript)
- Tailwind CSS
- technicalindicators library
- OKX REST API v5

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Get OKX Demo API Credentials

1. Go to [OKX Demo Trading](https://www.okx.com/demo-trading)
2. Click on your profile icon → **API** (or go to API Management)
3. Click **Create Demo Trading API Key**
4. Set permissions: **Trade** (required)
5. Save your credentials:
   - **API Key**
   - **Secret Key** (shown only once!)
   - **Passphrase** (you set this)

> ⚠️ **Important**: Demo API keys are different from Live API keys!

### 3. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# ==========================================
# DEMO TRADING CREDENTIALS (Recommended for testing)
# ==========================================
OKX_DEMO_API_KEY=your-demo-api-key
OKX_DEMO_SECRET_KEY=your-demo-secret-key
OKX_DEMO_PASSPHRASE=your-demo-passphrase

# Start in demo mode
OKX_DEMO_MODE=true

# ==========================================
# LIVE TRADING CREDENTIALS (Real Money!)
# ==========================================
# Only add these when you're ready for live trading
# OKX_API_KEY=your-live-api-key
# OKX_SECRET_KEY=your-live-secret-key
# OKX_PASSPHRASE=your-live-passphrase
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Demo vs Live Trading

| Feature | Demo Mode | Live Mode |
|---------|-----------|-----------|
| Real Money | ❌ No | ✅ Yes |
| API Credentials | Demo API Keys | Live API Keys |
| OKX Header | `x-simulated-trading: 1` | None |
| Positions | Visible in OKX Demo | Visible in OKX Futures |
| Risk | None | Real financial loss |

### Switching Modes

1. **Via Dashboard**: Click the DEMO/LIVE toggle button in the sidebar
2. **Via Environment**: Set `OKX_DEMO_MODE=true` or `false` in `.env.local`

> The bot uses different API credentials based on the selected mode.

## Trading Configuration

Configure via the dashboard sidebar:

- **Trade Size**: Amount in USDT per trade (default: $10)
- **Leverage**: 1x to 125x (default: 1x)

Click **[SAVE CONFIG]** to apply changes.

## Trading Strategy

The bot uses a Simple Moving Average (SMA) crossover strategy:

- **Fast MA**: 9-period SMA
- **Slow MA**: 21-period SMA
- **BUY Signal**: When Fast MA crosses above Slow MA
- **SELL Signal**: When Fast MA crosses below Slow MA

### Trade Execution

- **Instruments**: Perpetual contracts (BTC-USDT-SWAP, ETH-USDT-SWAP, etc.)
- **Order Type**: Market orders
- **Margin Mode**: Cross margin
- **Cooldown**: 30 seconds per pair after each trade
- **Independent Pairs**: Each trading pair is tracked separately

## Project Structure

```
├── app/
│   ├── page.js              # Dashboard UI
│   ├── layout.js            # Root layout
│   ├── globals.css          # Terminal-style CSS
│   └── api/
│       ├── market/route.js  # Market data endpoint
│       ├── bot/route.js     # Bot control endpoint
│       ├── account/route.js # Balance endpoint
│       ├── positions/route.js # Position management
│       ├── settings/route.js  # Settings endpoint
│       └── trades/route.js  # Trade history
├── lib/
│   ├── okxClient.js         # OKX API client with auth
│   ├── strategy.js          # Trading strategy logic
│   ├── state.js             # In-memory bot state
│   └── tradeLog.js          # Trade logging
├── .env.example             # Environment template
├── package.json
└── README.md
```

## API Endpoints

### GET /api/market?instId=BTC-USDT

Fetches market data and analysis for a trading pair.

### POST /api/bot

Control the trading bot:
```json
{ "action": "start" }  // Start bot
{ "action": "stop" }   // Stop bot
```

### GET /api/bot?action=cycle

Trigger a trading cycle manually.

### GET /api/positions?updatePrices=true

Get active positions with real-time prices.

### POST /api/settings

Update settings:
```json
{
  "demoMode": true,
  "tradeSize": 100,
  "leverage": 10
}
```

## Security

- API keys stored in environment variables only
- `.env.local` is gitignored (never committed)
- All trading operations are server-side
- Separate credentials for Demo vs Live

## Troubleshooting

### "You can't complete this request under your current account mode"

Your OKX account needs to be in margin mode for perpetual trading. The bot automatically attempts to set this, but you may need to:
1. Go to OKX → Assets → Switch to Single-currency margin mode
2. Or close any open positions first

### Trades not appearing in OKX app

- **Demo trades**: Check OKX Demo Trading → Futures → Positions
- **Live trades**: Check OKX → Trade → Futures → Positions

### Config keeps resetting

State is stored in memory and resets on server restart. This is by design for development. Consider using a database for production.

## License

MIT - Use at your own risk.

## Disclaimer

This software is for educational purposes only. Trading cryptocurrencies involves substantial risk of loss. The authors are not responsible for any financial losses incurred through the use of this software. Always test with demo trading first.
