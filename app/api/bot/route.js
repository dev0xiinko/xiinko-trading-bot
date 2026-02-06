/**
 * Bot Control API Route
 * 
 * ⚠️ WARNING: This bot trades with REAL MONEY in live mode!
 * Use demo mode for testing. Always test with small amounts first.
 * 
 * Endpoints:
 * - GET: Get bot status and trigger a trading cycle
 * - POST: Start/stop the bot
 */

import { NextResponse } from 'next/server'
import { getCandles, getTicker, placeMarketOrder, isConfigured, isDemoMode } from '@/lib/okxClient'
import { analyzeMarket, shouldTrade } from '@/lib/strategy'
import {
  getState,
  setBotRunning,
  setSignal,
  recordTrade as recordTradeState,
  updateMarketData,
  updateMarketPrice,
  isInCooldown,
  addLog,
  addPosition,
  getTradeConfig,
  getPairState,
  updatePairState,
  setPairSignal,
  isPairInCooldown,
  getPairCooldownRemaining,
  botState,
} from '@/lib/state'
import { recordTrade as logTrade } from '@/lib/tradeLog'

// Trading configuration
const CANDLE_TIMEFRAME = '1m'
const CANDLE_LIMIT = 100

// Trading pairs to monitor
const TRADING_PAIRS = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'XRP-USDT',
  'DOGE-USDT',
  'ADA-USDT',
]

/**
 * Execute trade for a single pair
 */
async function executePairTrade(instId) {
  try {
    // Check pair-specific cooldown
    if (isPairInCooldown(instId)) {
      const remaining = getPairCooldownRemaining(instId)
      return { instId, executed: false, reason: `Cooldown ${remaining}s` }
    }
    
    // Fetch market data
    const ticker = await getTicker(instId)
    const candles = await getCandles(instId, CANDLE_TIMEFRAME, CANDLE_LIMIT)
    const closePrices = candles.map(c => c.close)
    
    // Analyze market
    const analysis = analyzeMarket(closePrices)
    
    // Update market price for position tracking
    updateMarketPrice(instId, ticker.last)
    
    // Update pair signal
    setPairSignal(instId, analysis.signal)
    
    // Get pair-specific state
    const pairState = getPairState(instId)
    
    // Check if we should trade for this pair
    const tradeDecision = shouldTrade(analysis.signal, pairState.lastPosition)
    
    if (!tradeDecision.shouldTrade) {
      return { instId, executed: false, reason: tradeDecision.reason, signal: analysis.signal }
    }
    
    // Execute trade
    const mode = isDemoMode() ? 'demo' : 'live'
    const tradeConfig = getTradeConfig()
    const tradeSize = String(tradeConfig.tradeSize)
    const leverage = tradeConfig.leverage
    
    addLog(`[${instId}] ${tradeDecision.side.toUpperCase()} @ $${ticker.last} - ${tradeSize} USDT @ ${leverage}x`, 'trade')
    
    const order = await placeMarketOrder(
      instId,
      tradeDecision.side,
      tradeSize,
      leverage
    )
    
    // Update pair state
    updatePairState(instId, tradeDecision.side)
    
    // Record trade in state (global)
    recordTradeState(tradeDecision.side, ticker.last, tradeSize)
    
    // Add to active positions
    addPosition({
      instId: instId,
      side: tradeDecision.side,
      size: tradeSize,
      price: ticker.last,
      orderId: order.orderId,
      mode: mode,
      leverage: leverage,
    })
    
    // Log trade for analysis
    logTrade({
      mode: mode,
      instId: instId,
      side: tradeDecision.side,
      price: ticker.last,
      size: tradeSize,
      leverage: leverage,
      signal: analysis.signal,
      fastMA: analysis.fastMA,
      slowMA: analysis.slowMA,
      orderId: order.orderId,
      reason: tradeDecision.reason,
    })
    
    const simText = order.simulated ? ' (SIM)' : ''
    addLog(`[${instId}] Order filled! ${order.orderId}${simText}`, 'trade')
    
    return {
      instId,
      executed: true,
      mode: mode,
      side: tradeDecision.side,
      price: ticker.last,
      orderId: order.orderId,
    }
    
  } catch (error) {
    addLog(`[${instId}] Error: ${error.message}`, 'error')
    return { instId, executed: false, reason: error.message }
  }
}

/**
 * Execute one trading cycle for all pairs
 * 
 * 1. Loop through all trading pairs
 * 2. Analyze each pair independently
 * 3. Execute trades where conditions are met
 */
async function executeTradingCycle() {
  try {
    addLog(`Scanning ${TRADING_PAIRS.length} pairs...`, 'info')
    
    // Check if API is configured
    if (!isConfigured()) {
      addLog('API not configured - skipping trade execution', 'error')
      return { executed: false, reason: 'API not configured', trades: [] }
    }
    
    const results = []
    let tradesExecuted = 0
    
    // Process each pair with a small delay to avoid rate limits
    for (const instId of TRADING_PAIRS) {
      try {
        const result = await executePairTrade(instId)
        results.push(result)
        
        if (result.executed) {
          tradesExecuted++
        }
        
        // Small delay between pairs to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200))
        
      } catch (pairError) {
        addLog(`[${instId}] Failed: ${pairError.message}`, 'error')
        results.push({ instId, executed: false, reason: pairError.message })
      }
    }
    
    addLog(`Cycle complete: ${tradesExecuted}/${TRADING_PAIRS.length} trades executed`, 'info')
    
    // Update global state with first pair's data for backward compatibility
    if (results.length > 0) {
      const btcResult = results.find(r => r.instId === 'BTC-USDT')
      if (btcResult && btcResult.signal) {
        setSignal(btcResult.signal)
      }
    }
    
    return {
      executed: tradesExecuted > 0,
      tradesExecuted,
      totalPairs: TRADING_PAIRS.length,
      trades: results,
    }
    
  } catch (error) {
    addLog(`Trading cycle error: ${error.message}`, 'error')
    throw error
  }
}

/**
 * GET /api/bot
 * 
 * Trigger a trading cycle and return current state
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    
    // If action=cycle, execute a trading cycle
    if (action === 'cycle' && botState.isRunning) {
      const result = await executeTradingCycle()
      return NextResponse.json({
        success: true,
        cycle: result,
        state: getState(),
      })
    }
    
    // Otherwise just return current state
    return NextResponse.json({
      success: true,
      state: getState(),
      configured: isConfigured(),
      demoMode: isDemoMode(),
    })
    
  } catch (error) {
    console.error('Bot GET error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      state: getState(),
    }, { status: 500 })
  }
}

/**
 * POST /api/bot
 * 
 * Control the bot (start/stop)
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { action } = body
    
    if (action === 'start') {
      // Check if configured
      if (!isConfigured()) {
        return NextResponse.json({
          success: false,
          error: 'OKX API credentials not configured. Please set up your .env file.',
          state: getState(),
        }, { status: 400 })
      }
      
      setBotRunning(true)
      addLog('Bot started - will execute trades when conditions are met', 'info')
      
      return NextResponse.json({
        success: true,
        message: 'Bot started',
        state: getState(),
      })
    }
    
    if (action === 'stop') {
      setBotRunning(false)
      addLog('Bot stopped - no more trades will be executed', 'info')
      
      return NextResponse.json({
        success: true,
        message: 'Bot stopped',
        state: getState(),
      })
    }
    
    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use "start" or "stop".',
    }, { status: 400 })
    
  } catch (error) {
    console.error('Bot POST error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      state: getState(),
    }, { status: 500 })
  }
}
