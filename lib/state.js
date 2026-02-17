/**
 * In-memory bot state management
 * 
 * Trade config is persisted to file for survival across server restarts.
 */

import fs from 'fs'
import path from 'path'

// Config file path
const CONFIG_FILE = path.join(process.cwd(), '.trade-config.json')

// Load persisted config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8')
      const config = JSON.parse(data)
      console.log(`[CONFIG] Loaded: ${config.tradeSize} USDT @ ${config.leverage}x`)
      return {
        tradeSize: config.tradeSize || 10,
        leverage: config.leverage || 1,
        maxLeverage: 125,
      }
    }
  } catch (err) {
    console.error('[CONFIG] Failed to load config:', err.message)
  }
  return {
    tradeSize: 10,
    leverage: 1,
    maxLeverage: 125,
  }
}

// Save config to file
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
    console.log(`[CONFIG] Saved: ${config.tradeSize} USDT @ ${config.leverage}x`)
  } catch (err) {
    console.error('[CONFIG] Failed to save config:', err.message)
  }
}

// Bot state singleton
const botState = {
  // Is the bot currently running/active
  isRunning: false,
  
  // Current trading signal: 'BUY', 'SELL', or 'WAIT'
  currentSignal: 'WAIT',
  
  // Last position direction to prevent repeated trades (GLOBAL - legacy)
  // 'long', 'short', or null
  lastPosition: null,
  
  // Per-pair state tracking
  // { 'BTC-USDT': { lastPosition: 'long', lastTradeTime: timestamp, signal: 'BUY' }, ... }
  pairState: {},
  
  // Cooldown management (global)
  lastTradeTime: null,
  cooldownSeconds: 60,
  
  // Per-pair cooldown (seconds) - shorter for multi-pair trading
  pairCooldownSeconds: 30,
  
  // Last executed trade details
  lastTrade: null,
  
  // Active positions array
  // Each position: { id, instId, side, size, entryPrice, currentPrice, timestamp, orderId }
  positions: [],
  
  // Trade configuration - loaded from file
  tradeConfig: loadConfig(),
  
  // Recent logs (keep last 50)
  logs: [],
  maxLogs: 100,
  
  // Market data cache (keyed by instId)
  marketPrices: {},
  lastPrice: null,
  fastMA: null,
  slowMA: null,
  
  // Bot loop interval ID
  intervalId: null,
}

/**
 * Add a log entry with timestamp
 */
export function addLog(message, type = 'info') {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    type, // 'info', 'trade', 'error', 'signal'
  }
  
  botState.logs.unshift(entry)
  
  // Keep only the last N logs
  if (botState.logs.length > botState.maxLogs) {
    botState.logs = botState.logs.slice(0, botState.maxLogs)
  }
  
  // Also log to console for debugging
  console.log(`[${type.toUpperCase()}] ${message}`)
}

/**
 * Update the current signal
 */
export function setSignal(signal) {
  if (botState.currentSignal !== signal) {
    addLog(`Signal changed: ${botState.currentSignal} → ${signal}`, 'signal')
  }
  botState.currentSignal = signal
}

/**
 * Record a completed trade
 */
export function recordTrade(side, price, size) {
  botState.lastTrade = {
    side,
    price,
    size,
    timestamp: new Date().toISOString(),
  }
  botState.lastTradeTime = Date.now()
  botState.lastPosition = side === 'buy' ? 'long' : 'short'
  
  addLog(`Trade executed: ${side.toUpperCase()} ${size} USDT at $${price}`, 'trade')
}

/**
 * Check if bot is in cooldown period
 */
export function isInCooldown() {
  if (!botState.lastTradeTime) return false
  
  const elapsed = (Date.now() - botState.lastTradeTime) / 1000
  return elapsed < botState.cooldownSeconds
}

/**
 * Get remaining cooldown time in seconds
 */
export function getCooldownRemaining() {
  if (!botState.lastTradeTime) return 0
  
  const elapsed = (Date.now() - botState.lastTradeTime) / 1000
  const remaining = botState.cooldownSeconds - elapsed
  
  return Math.max(0, Math.round(remaining))
}

/**
 * Get pair-specific state
 */
export function getPairState(instId) {
  if (!botState.pairState[instId]) {
    botState.pairState[instId] = {
      lastPosition: null,
      lastTradeTime: null,
      signal: 'WAIT',
    }
  }
  return botState.pairState[instId]
}

/**
 * Update pair-specific state after a trade
 */
export function updatePairState(instId, side) {
  if (!botState.pairState[instId]) {
    botState.pairState[instId] = {}
  }
  botState.pairState[instId].lastPosition = side === 'buy' ? 'long' : 'short'
  botState.pairState[instId].lastTradeTime = Date.now()
}

/**
 * Set signal for a specific pair
 */
export function setPairSignal(instId, signal) {
  if (!botState.pairState[instId]) {
    botState.pairState[instId] = { lastPosition: null, lastTradeTime: null }
  }
  botState.pairState[instId].signal = signal
}

/**
 * Check if a specific pair is in cooldown
 */
export function isPairInCooldown(instId) {
  const pairState = botState.pairState[instId]
  if (!pairState || !pairState.lastTradeTime) return false
  
  const elapsed = (Date.now() - pairState.lastTradeTime) / 1000
  return elapsed < botState.pairCooldownSeconds
}

/**
 * Get remaining cooldown for a specific pair
 */
export function getPairCooldownRemaining(instId) {
  const pairState = botState.pairState[instId]
  if (!pairState || !pairState.lastTradeTime) return 0
  
  const elapsed = (Date.now() - pairState.lastTradeTime) / 1000
  const remaining = botState.pairCooldownSeconds - elapsed
  
  return Math.max(0, Math.round(remaining))
}

/**
 * Update market data
 */
export function updateMarketData(price, fastMA, slowMA) {
  botState.lastPrice = price
  botState.fastMA = fastMA
  botState.slowMA = slowMA
}

/**
 * Update market price for a specific instrument
 */
export function updateMarketPrice(instId, price) {
  botState.marketPrices[instId] = {
    price: parseFloat(price),
    timestamp: Date.now()
  }
  
  // Also update current price for any positions with this instId
  botState.positions = botState.positions.map(pos => {
    if (pos.instId === instId) {
      return { ...pos, currentPrice: parseFloat(price) }
    }
    return pos
  })
}

/**
 * Add a new position
 */
export function addPosition(position) {
  const entryPrice = parseFloat(position.price)
  const size = parseFloat(position.size)
  const leverage = parseFloat(position.leverage) || 1
  
  const newPosition = {
    id: position.orderId || `pos_${Date.now()}`,
    instId: position.instId,
    side: position.side,
    size: size,
    leverage: leverage,
    entryPrice: entryPrice,
    currentPrice: entryPrice,
    timestamp: new Date().toISOString(),
    orderId: position.orderId,
    mode: position.mode || 'live'
  }
  
  // Check if opposite position exists - if so, close it (simulating a flip)
  const oppositeIndex = botState.positions.findIndex(
    p => p.instId === position.instId && p.side !== position.side
  )
  
  if (oppositeIndex !== -1) {
    // Close the opposite position
    const closedPos = botState.positions[oppositeIndex]
    botState.positions.splice(oppositeIndex, 1)
    addLog(`Position closed: ${closedPos.side.toUpperCase()} ${closedPos.instId}`, 'trade')
  }
  
  // Check if same-side position exists - if so, add to it
  const sameIndex = botState.positions.findIndex(
    p => p.instId === position.instId && p.side === position.side
  )
  
  if (sameIndex !== -1) {
    // Add to existing position (average entry price)
    const existing = botState.positions[sameIndex]
    const existingSize = parseFloat(existing.size)
    const existingEntry = parseFloat(existing.entryPrice)
    const totalSize = existingSize + size
    const avgPrice = ((existingEntry * existingSize) + (entryPrice * size)) / totalSize
    
    botState.positions[sameIndex] = {
      ...existing,
      size: totalSize,
      entryPrice: avgPrice,
      leverage: leverage, // Use latest leverage
    }
    addLog(`Position added: ${position.side.toUpperCase()} ${position.instId} (avg: $${avgPrice.toFixed(2)})`, 'trade')
  } else {
    // New position
    botState.positions.push(newPosition)
    addLog(`Position opened: ${position.side.toUpperCase()} ${position.size} ${position.instId} @ $${position.price}`, 'trade')
  }
  
  return newPosition
}

/**
 * Close a position by ID
 */
export function closePosition(positionId) {
  const index = botState.positions.findIndex(p => p.id === positionId)
  if (index !== -1) {
    const pos = botState.positions[index]
    botState.positions.splice(index, 1)
    addLog(`Position manually closed: ${pos.side.toUpperCase()} ${pos.instId}`, 'trade')
    return pos
  }
  return null
}

/**
 * Get all active positions with updated prices
 */
export function getPositions() {
  return botState.positions.map(pos => {
    // Update current price from market prices cache if available
    const marketData = botState.marketPrices[pos.instId]
    if (marketData) {
      return { ...pos, currentPrice: marketData.price }
    }
    return pos
  })
}

/**
 * Clear all positions
 */
export function clearPositions() {
  botState.positions = []
  addLog('All positions cleared', 'info')
}

/**
 * Get trade configuration
 */
export function getTradeConfig() {
  return { ...botState.tradeConfig }
}

/**
 * Update trade configuration
 */
export function setTradeConfig(config) {
  let changed = false
  
  if (typeof config.tradeSize === 'number' && config.tradeSize > 0) {
    botState.tradeConfig.tradeSize = config.tradeSize
    addLog(`Trade size updated to ${config.tradeSize} USDT`, 'info')
    changed = true
  }
  
  if (typeof config.leverage === 'number') {
    const leverage = Math.min(
      Math.max(1, config.leverage), 
      botState.tradeConfig.maxLeverage
    )
    botState.tradeConfig.leverage = leverage
    addLog(`Leverage updated to ${leverage}x`, 'info')
    changed = true
  }
  
  // Persist config to file
  if (changed) {
    saveConfig(botState.tradeConfig)
  }
  
  return getTradeConfig()
}

/**
 * Set bot running state
 */
export function setBotRunning(isRunning) {
  botState.isRunning = isRunning
  addLog(`Bot ${isRunning ? 'started' : 'stopped'}`, 'info')
}

/**
 * Get full state for API response
 */
export function getState() {
  return {
    isRunning: botState.isRunning,
    currentSignal: botState.currentSignal,
    lastPosition: botState.lastPosition,
    isInCooldown: isInCooldown(),
    cooldownRemaining: getCooldownRemaining(),
    lastTrade: botState.lastTrade,
    lastPrice: botState.lastPrice,
    fastMA: botState.fastMA,
    slowMA: botState.slowMA,
    logs: botState.logs,
    positions: getPositions(),
    tradeConfig: getTradeConfig(),
    pairState: botState.pairState,
  }
}

/**
 * Reset bot state (useful for testing)
 */
export function resetState() {
  botState.isRunning = false
  botState.currentSignal = 'WAIT'
  botState.lastPosition = null
  botState.lastTradeTime = null
  botState.lastTrade = null
  botState.positions = []
  botState.pairState = {}
  botState.marketPrices = {}
  botState.logs = []
  botState.lastPrice = null
  botState.fastMA = null
  botState.slowMA = null
  
  addLog('Bot state reset', 'info')
}

// Export the raw state for direct access if needed
export { botState }
