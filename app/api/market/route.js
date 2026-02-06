/**
 * Market Data API Route
 * 
 * Fetches market data from OKX and analyzes it using our strategy.
 * Supports dynamic instrument ID via query parameter.
 */

import { NextResponse } from 'next/server'
import { getCandles, getTicker, isConfigured } from '@/lib/okxClient'
import { analyzeMarket } from '@/lib/strategy'
import { getState, updateMarketData, setSignal, addLog } from '@/lib/state'

// Default configuration
const DEFAULT_INSTRUMENT = 'BTC-USDT'
const CANDLE_TIMEFRAME = '1m'
const CANDLE_LIMIT = 100

/**
 * GET /api/market?instId=BTC-USDT
 * 
 * Returns current market data, analysis, and bot state
 */
export async function GET(request) {
  try {
    // Get instrument ID from query params or use default
    const { searchParams } = new URL(request.url)
    const instId = searchParams.get('instId') || DEFAULT_INSTRUMENT
    
    // Fetch current ticker price
    const ticker = await getTicker(instId)
    
    // Fetch historical candles for strategy analysis
    const candles = await getCandles(instId, CANDLE_TIMEFRAME, CANDLE_LIMIT)
    
    // Extract close prices for analysis
    const closePrices = candles.map(c => c.close)
    
    // Run strategy analysis
    const analysis = analyzeMarket(closePrices)
    
    // Only update global state for the main pair (BTC-USDT)
    if (instId === DEFAULT_INSTRUMENT) {
      updateMarketData(ticker.last, analysis.fastMA, analysis.slowMA)
      setSignal(analysis.signal)
    }
    
    // Get current bot state
    const state = getState()
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      market: {
        instId: instId,
        price: ticker.last,
        bid: ticker.bid,
        ask: ticker.ask,
        high24h: ticker.high24h,
        low24h: ticker.low24h,
        volume24h: ticker.volume24h,
      },
      analysis: {
        signal: analysis.signal,
        reason: analysis.reason,
        fastMA: analysis.fastMA,
        slowMA: analysis.slowMA,
        fastMAPeriod: analysis.fastMAPeriod,
        slowMAPeriod: analysis.slowMAPeriod,
      },
      bot: {
        isRunning: state.isRunning,
        isInCooldown: state.isInCooldown,
        cooldownRemaining: state.cooldownRemaining,
        lastPosition: state.lastPosition,
        lastTrade: state.lastTrade,
        logs: state.logs.slice(0, 20),
      },
      configured: isConfigured(),
    })
  } catch (error) {
    console.error('Market API error:', error)
    addLog(`Market data error: ${error.message}`, 'error')
    
    return NextResponse.json({
      success: false,
      error: error.message,
      bot: getState(),
    }, { status: 500 })
  }
}
