/**
 * Trade Logging System
 * 
 * Records all trades for analysis and backtesting.
 * Stores trade history in memory (can be extended to file/database).
 * 
 * Features:
 * - Record trades with full details
 * - Calculate P&L statistics
 * - Export trade history
 * - Performance analysis
 */

// In-memory trade storage
const tradeHistory = []
const MAX_TRADES = 1000

/**
 * Record a new trade
 */
export function recordTrade(trade) {
  const tradeEntry = {
    id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...trade,
    // Calculated fields
    value: trade.price * (parseFloat(trade.size) / trade.price), // Approximate value
  }
  
  tradeHistory.unshift(tradeEntry)
  
  // Keep only last MAX_TRADES
  if (tradeHistory.length > MAX_TRADES) {
    tradeHistory.pop()
  }
  
  console.log(`[TRADE LOG] ${trade.mode === 'demo' ? '[DEMO]' : '[LIVE]'} ${trade.side.toUpperCase()} ${trade.instId} @ ${trade.price}`)
  
  return tradeEntry
}

/**
 * Get all trade history
 */
export function getTradeHistory(options = {}) {
  let trades = [...tradeHistory]
  
  // Filter by mode (demo/live)
  if (options.mode) {
    trades = trades.filter(t => t.mode === options.mode)
  }
  
  // Filter by instrument
  if (options.instId) {
    trades = trades.filter(t => t.instId === options.instId)
  }
  
  // Filter by side
  if (options.side) {
    trades = trades.filter(t => t.side === options.side)
  }
  
  // Filter by date range
  if (options.startDate) {
    trades = trades.filter(t => new Date(t.timestamp) >= new Date(options.startDate))
  }
  if (options.endDate) {
    trades = trades.filter(t => new Date(t.timestamp) <= new Date(options.endDate))
  }
  
  // Limit results
  if (options.limit) {
    trades = trades.slice(0, options.limit)
  }
  
  return trades
}

/**
 * Calculate trading statistics
 */
export function getTradeStats(mode = null) {
  let trades = mode ? tradeHistory.filter(t => t.mode === mode) : tradeHistory
  
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      buyTrades: 0,
      sellTrades: 0,
      winRate: 0,
      totalPnL: 0,
      avgTradeSize: 0,
      mostTradedPair: null,
      firstTrade: null,
      lastTrade: null,
    }
  }
  
  const buyTrades = trades.filter(t => t.side === 'buy')
  const sellTrades = trades.filter(t => t.side === 'sell')
  
  // Calculate P&L (simplified - matches buy/sell pairs)
  let totalPnL = 0
  let wins = 0
  let losses = 0
  
  // Group by instrument and match trades
  const pairTrades = {}
  trades.forEach(t => {
    if (!pairTrades[t.instId]) pairTrades[t.instId] = []
    pairTrades[t.instId].push(t)
  })
  
  Object.values(pairTrades).forEach(pairTradeList => {
    let position = null
    
    pairTradeList.reverse().forEach(trade => {
      if (trade.side === 'buy' && !position) {
        position = { entryPrice: trade.price, size: trade.size }
      } else if (trade.side === 'sell' && position) {
        const pnl = (trade.price - position.entryPrice) * (parseFloat(position.size) / position.entryPrice)
        totalPnL += pnl
        if (pnl > 0) wins++
        else losses++
        position = null
      }
    })
  })
  
  // Most traded pair
  const pairCounts = {}
  trades.forEach(t => {
    pairCounts[t.instId] = (pairCounts[t.instId] || 0) + 1
  })
  const mostTradedPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  
  // Average trade size
  const avgTradeSize = trades.reduce((sum, t) => sum + parseFloat(t.size), 0) / trades.length
  
  return {
    totalTrades: trades.length,
    buyTrades: buyTrades.length,
    sellTrades: sellTrades.length,
    winRate: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0,
    wins,
    losses,
    totalPnL: totalPnL.toFixed(2),
    avgTradeSize: avgTradeSize.toFixed(2),
    mostTradedPair,
    firstTrade: trades[trades.length - 1]?.timestamp || null,
    lastTrade: trades[0]?.timestamp || null,
  }
}

/**
 * Clear all trade history
 */
export function clearTradeHistory(mode = null) {
  if (mode) {
    // Remove only trades of specific mode
    const toKeep = tradeHistory.filter(t => t.mode !== mode)
    tradeHistory.length = 0
    tradeHistory.push(...toKeep)
  } else {
    tradeHistory.length = 0
  }
  
  console.log(`[TRADE LOG] Cleared ${mode || 'all'} trade history`)
}

/**
 * Export trades as JSON
 */
export function exportTrades(mode = null) {
  const trades = mode ? tradeHistory.filter(t => t.mode === mode) : tradeHistory
  const stats = getTradeStats(mode)
  
  return {
    exportDate: new Date().toISOString(),
    mode: mode || 'all',
    stats,
    trades,
  }
}

/**
 * Get recent trades summary
 */
export function getRecentTradesSummary(count = 10) {
  return tradeHistory.slice(0, count).map(t => ({
    id: t.id,
    timestamp: t.timestamp,
    mode: t.mode,
    instId: t.instId,
    side: t.side,
    price: t.price,
    size: t.size,
    signal: t.signal,
    orderId: t.orderId,
  }))
}
