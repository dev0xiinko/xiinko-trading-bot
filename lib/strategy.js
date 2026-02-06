/**
 * Trading Strategy: Moving Average Crossover
 * 
 * Strategy Logic:
 * - Fast MA (9 periods) crossing above Slow MA (21 periods) = BUY signal
 * - Fast MA (9 periods) crossing below Slow MA (21 periods) = SELL signal
 * - Otherwise = WAIT
 * 
 * This is a simple trend-following strategy.
 * 
 * ⚠️ WARNING: Past performance does not guarantee future results!
 * Use at your own risk with money you can afford to lose.
 */

import { SMA } from 'technicalindicators'

// Strategy parameters
const FAST_MA_PERIOD = 9
const SLOW_MA_PERIOD = 21

/**
 * Calculate Simple Moving Average
 * 
 * @param {number[]} prices - Array of close prices
 * @param {number} period - MA period
 * @returns {number[]} - Array of MA values
 */
export function calculateSMA(prices, period) {
  return SMA.calculate({
    period: period,
    values: prices,
  })
}

/**
 * Analyze market data and generate trading signal
 * 
 * @param {number[]} closePrices - Array of close prices (oldest first)
 * @returns {Object} - Analysis result with signal and MA values
 */
export function analyzeMarket(closePrices) {
  if (!closePrices || closePrices.length < SLOW_MA_PERIOD + 2) {
    return {
      signal: 'WAIT',
      reason: 'Insufficient data for analysis',
      fastMA: null,
      slowMA: null,
    }
  }
  
  // Calculate moving averages
  const fastMAValues = calculateSMA(closePrices, FAST_MA_PERIOD)
  const slowMAValues = calculateSMA(closePrices, SLOW_MA_PERIOD)
  
  // Get current and previous MA values
  const currentFastMA = fastMAValues[fastMAValues.length - 1]
  const currentSlowMA = slowMAValues[slowMAValues.length - 1]
  const prevFastMA = fastMAValues[fastMAValues.length - 2]
  const prevSlowMA = slowMAValues[slowMAValues.length - 2]
  
  // Round for cleaner display
  const fastMA = Math.round(currentFastMA * 100) / 100
  const slowMA = Math.round(currentSlowMA * 100) / 100
  
  let signal = 'WAIT'
  let reason = ''
  
  // Detect crossover
  // BUY: Fast MA crosses above Slow MA
  if (prevFastMA <= prevSlowMA && currentFastMA > currentSlowMA) {
    signal = 'BUY'
    reason = `Bullish crossover: Fast MA (${fastMA}) crossed above Slow MA (${slowMA})`
  }
  // SELL: Fast MA crosses below Slow MA
  else if (prevFastMA >= prevSlowMA && currentFastMA < currentSlowMA) {
    signal = 'SELL'
    reason = `Bearish crossover: Fast MA (${fastMA}) crossed below Slow MA (${slowMA})`
  }
  // Trend continuation signals (for display purposes)
  else if (currentFastMA > currentSlowMA) {
    signal = 'BUY'
    reason = `Bullish trend: Fast MA (${fastMA}) above Slow MA (${slowMA})`
  }
  else if (currentFastMA < currentSlowMA) {
    signal = 'SELL'
    reason = `Bearish trend: Fast MA (${fastMA}) below Slow MA (${slowMA})`
  }
  else {
    reason = `MAs converging: Fast MA (${fastMA}) ≈ Slow MA (${slowMA})`
  }
  
  return {
    signal,
    reason,
    fastMA,
    slowMA,
    fastMAPeriod: FAST_MA_PERIOD,
    slowMAPeriod: SLOW_MA_PERIOD,
  }
}

/**
 * Determine if we should execute a trade
 * 
 * @param {string} signal - Current signal ('BUY', 'SELL', 'WAIT')
 * @param {string|null} lastPosition - Last position ('long', 'short', or null)
 * @returns {Object} - Trade decision
 */
export function shouldTrade(signal, lastPosition) {
  // No trade if signal is WAIT
  if (signal === 'WAIT') {
    return {
      shouldTrade: false,
      reason: 'No clear signal',
    }
  }
  
  // Prevent repeated trades in same direction
  if (signal === 'BUY' && lastPosition === 'long') {
    return {
      shouldTrade: false,
      reason: 'Already in long position',
    }
  }
  
  if (signal === 'SELL' && lastPosition === 'short') {
    return {
      shouldTrade: false,
      reason: 'Already in short position',
    }
  }
  
  // Trade is allowed
  return {
    shouldTrade: true,
    side: signal === 'BUY' ? 'buy' : 'sell',
    reason: `${signal} signal confirmed`,
  }
}

/**
 * Get strategy info for display
 */
export function getStrategyInfo() {
  return {
    name: 'MA Crossover',
    description: 'Simple Moving Average crossover strategy',
    fastPeriod: FAST_MA_PERIOD,
    slowPeriod: SLOW_MA_PERIOD,
    rules: [
      `BUY when ${FAST_MA_PERIOD}-MA crosses above ${SLOW_MA_PERIOD}-MA`,
      `SELL when ${FAST_MA_PERIOD}-MA crosses below ${SLOW_MA_PERIOD}-MA`,
    ],
  }
}
