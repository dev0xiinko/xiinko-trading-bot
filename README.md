# OKX Trading Dashboard

A tile-based web trading dashboard with an automatic trading bot using the OKX API.

## ⚠️ Warning

**This bot trades with REAL MONEY when connected to your OKX account!**

- Use at your own risk
- Always test with small amounts first
- Never invest more than you can afford to lose
- Past performance does not guarantee future results

## Features

- **Real-time Price Display**: BTC-USDT price updated every 5 seconds
- **MA Crossover Strategy**: 9-period vs 21-period moving average crossover
- **Automatic Trading**: Bot executes market orders when conditions are met
- **Visual Dashboard**: Clean tile-based UI with dark theme
- **Trade Logging**: Real-time logs of all bot activity

## Tech Stack

- Next.js 14 (App Router)
- JavaScript (no TypeScript)
- Tailwind CSS
- technicalindicators library
- OKX REST API

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# OKX API Credentials
# Get these from: https://www.okx.com/account/my-api
OKX_API_KEY=your_api_key_here
OKX_SECRET_KEY=your_secret_key_here
OKX_PASSPHRASE=your_passphrase_here
```

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
├── app/
│   ├── page.js              # Dashboard UI
│   ├── layout.js            # Root layout
│   ├── globals.css          # Global styles
│   └── api/
│       ├── market/route.js  # Market data endpoint
│       └── bot/route.js     # Bot control endpoint
├── lib/
│   ├── okxClient.js         # OKX API client with auth
│   ├── strategy.js          # Trading strategy logic
│   └── state.js             # In-memory bot state
├── .env.example             # Environment variables template
├── package.json
└── README.md
```

## Trading Strategy

The bot uses a Simple Moving Average (SMA) crossover strategy:

- **Fast MA**: 9-period SMA
- **Slow MA**: 21-period SMA
- **BUY Signal**: When Fast MA crosses above Slow MA
- **SELL Signal**: When Fast MA crosses below Slow MA

### Trade Execution Rules

- Trade size: 10 USDT per trade
- Mode: Cash (spot trading)
- Order type: Market orders
- Cooldown: 60 seconds between trades
- Prevents repeated trades in the same direction

## API Endpoints

### GET /api/market

Fetches current market data and bot state.

Response:
```json
{
  "success": true,
  "market": {
    "price": 50000,
    "high24h": 51000,
    "low24h": 49000
  },
  "analysis": {
    "signal": "BUY",
    "fastMA": 50100,
    "slowMA": 50000
  },
  "bot": {
    "isRunning": false,
    "lastTrade": null
  }
}
```

### POST /api/bot

Control the trading bot.

Start bot:
```json
{ "action": "start" }
```

Stop bot:
```json
{ "action": "stop" }
```

### GET /api/bot?action=cycle

Trigger a trading cycle (called automatically every 30 seconds).

## Dashboard Tiles

1. **Price Tile**: Shows current BTC-USDT price with 24h high/low
2. **Strategy Tile**: Displays current signal (BUY/SELL/WAIT) and MA values
3. **Bot Status Tile**: Shows if bot is running with start/stop control
4. **Last Trade Tile**: Details of the most recent trade
5. **MA Comparison Tile**: Visual comparison of fast and slow MAs
6. **Logs Tile**: Scrollable list of recent bot activity

## Security Notes

- API keys are stored in environment variables and never exposed to the client
- All trading operations happen server-side through API routes
- The dashboard only displays data; all sensitive operations are backend-only

## Development

### Refresh Intervals

- Market data: Every 5 seconds
- Bot trading cycle: Every 30 seconds (when running)

### Customization

To modify the strategy parameters, edit `lib/strategy.js`:

```javascript
const FAST_MA_PERIOD = 9   // Change fast MA period
const SLOW_MA_PERIOD = 21  // Change slow MA period
```

To change trade size, edit `app/api/bot/route.js`:

```javascript
const TRADE_SIZE_USDT = '10'  // Change trade size
```

## License

MIT - Use at your own risk.

## Disclaimer

This software is for educational purposes only. Trading cryptocurrencies involves substantial risk of loss. The authors are not responsible for any financial losses incurred through the use of this software.
