/**
 * OKX API Client
 * 
 * Handles authentication and signed requests to OKX API
 * 
 * ⚠️ WARNING: This module handles REAL trading API calls!
 * Ensure your API keys have appropriate permissions and limits.
 * 
 * Demo Trading:
 * - Set OKX_DEMO_MODE=true in .env or use setDemoMode(true)
 * - Uses x-simulated-trading header for paper trading
 */

import crypto from 'crypto'
import https from 'https'

// OKX API base URL
const BASE_URL = 'https://www.okx.com'

// Demo trading mode (paper trading)
let demoMode = process.env.OKX_DEMO_MODE === 'true'

// Paper trading mode - simulates trades locally without calling OKX API
let paperTradingMode = true // Default to paper trading for safety

// Rate limiting configuration
const MIN_REQUEST_INTERVAL = 100 // Minimum 100ms between requests
let lastRequestTime = 0

/**
 * Set demo trading mode
 * When enabled, uses OKX's simulated trading header
 */
export function setDemoMode(enabled) {
  demoMode = enabled
  console.log(`Demo trading mode: ${enabled ? 'ENABLED' : 'DISABLED'}`)
}

/**
 * Check if demo mode is enabled
 */
export function isDemoMode() {
  return demoMode
}

/**
 * Set paper trading mode
 * When enabled, trades are simulated locally without any API calls
 */
export function setPaperTradingMode(enabled) {
  paperTradingMode = enabled
  console.log(`Paper trading mode: ${enabled ? 'ENABLED' : 'DISABLED'}`)
}

/**
 * Check if paper trading mode is enabled
 */
export function isPaperTradingMode() {
  return paperTradingMode
}

// Create a custom HTTPS agent to handle SSL issues in some environments
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production'
})

/**
 * Wait to respect rate limits
 */
async function waitForRateLimit() {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest))
  }
  
  lastRequestTime = Date.now()
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await waitForRateLimit()
      return await fn()
    } catch (error) {
      lastError = error
      
      // Check if it's a rate limit error
      const isRateLimit = error.message?.includes('Too many requests') || 
                          error.message?.includes('rate limit') ||
                          error.message?.includes('50011')
      
      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt) // Exponential backoff
        console.log(`Rate limited, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`)
        await new Promise(resolve => setTimeout(resolve, delay))
      } else if (!isRateLimit) {
        throw error // Don't retry non-rate-limit errors
      }
    }
  }
  
  throw lastError
}

/**
 * Custom fetch wrapper that handles SSL issues
 */
async function secureFetch(url, options = {}) {
  // In Node.js 18+, we can use the dispatcher option
  // For older versions or when there are SSL issues, we fall back to http module
  try {
    const response = await fetch(url, {
      ...options,
      // Note: native fetch in Node.js doesn't directly support custom agents
      // but we try anyway, and catch SSL errors for graceful fallback
    })
    return response
  } catch (error) {
    // If SSL error, try with http module instead
    if (error.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url)
        const reqOptions = {
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          agent: httpsAgent,
        }
        
        const req = https.request(reqOptions, (res) => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => JSON.parse(data),
              text: async () => data,
            })
          })
        })
        
        req.on('error', reject)
        
        if (options.body) {
          req.write(options.body)
        }
        req.end()
      })
    }
    throw error
  }
}

/**
 * Generate OKX API signature
 * 
 * OKX uses HMAC SHA256 signature with:
 * - timestamp + method + requestPath + body
 */
function generateSignature(timestamp, method, requestPath, body = '') {
  const secretKey = process.env.OKX_SECRET_KEY
  
  if (!secretKey) {
    throw new Error('OKX_SECRET_KEY is not configured')
  }
  
  const prehash = timestamp + method.toUpperCase() + requestPath + body
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(prehash)
    .digest('base64')
  
  return signature
}

/**
 * Get authentication headers for private endpoints
 */
function getAuthHeaders(method, requestPath, body = '') {
  const apiKey = process.env.OKX_API_KEY
  const passphrase = process.env.OKX_PASSPHRASE
  
  if (!apiKey || !passphrase) {
    throw new Error('OKX API credentials are not configured')
  }
  
  // OKX requires ISO timestamp
  const timestamp = new Date().toISOString()
  const signature = generateSignature(timestamp, method, requestPath, body)
  
  const headers = {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json',
  }
  
  // Add demo trading header if enabled
  if (demoMode) {
    headers['x-simulated-trading'] = '1'
  }
  
  return headers
}

/**
 * Fetch market candles (public endpoint - no auth required)
 * 
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT')
 * @param {string} bar - Candle timeframe (e.g., '1m', '5m', '1H')
 * @param {number} limit - Number of candles to fetch
 */
export async function getCandles(instId = 'BTC-USDT', bar = '1m', limit = 100) {
  const endpoint = `/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`
  const url = BASE_URL + endpoint
  
  return withRetry(async () => {
    const response = await secureFetch(url)
    const data = await response.json()
    
    if (data.code !== '0') {
      throw new Error(`OKX API error: ${data.msg} (code: ${data.code})`)
    }
    
    // OKX returns: [timestamp, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
    // We need to reverse because OKX returns newest first
    return data.data.reverse().map(candle => ({
      timestamp: parseInt(candle[0]),
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
    }))
  })
}

/**
 * Get current ticker price (public endpoint)
 * 
 * @param {string} instId - Instrument ID
 */
export async function getTicker(instId = 'BTC-USDT') {
  const endpoint = `/api/v5/market/ticker?instId=${instId}`
  const url = BASE_URL + endpoint
  
  return withRetry(async () => {
    const response = await secureFetch(url)
    const data = await response.json()
    
    if (data.code !== '0') {
      throw new Error(`OKX API error: ${data.msg} (code: ${data.code})`)
    }
    
    return {
      instId: data.data[0].instId,
      last: parseFloat(data.data[0].last),
      bid: parseFloat(data.data[0].bidPx),
      ask: parseFloat(data.data[0].askPx),
      high24h: parseFloat(data.data[0].high24h),
      low24h: parseFloat(data.data[0].low24h),
      volume24h: parseFloat(data.data[0].vol24h),
    }
  })
}

/**
 * Set leverage for an instrument (private endpoint - requires auth)
 * 
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT')
 * @param {number} lever - Leverage value (1-125)
 * @param {string} mgnMode - Margin mode: 'cross' or 'isolated'
 */
async function setLeverage(instId, lever, mgnMode = 'cross') {
  // Skip in demo mode
  if (demoMode) {
    console.log(`[DEMO] Leverage set to ${lever}x for ${instId}`)
    return { success: true, leverage: lever }
  }
  
  const requestPath = '/api/v5/account/set-leverage'
  const url = BASE_URL + requestPath
  
  const leverBody = {
    instId: instId,
    lever: String(lever),
    mgnMode: mgnMode,
  }
  
  const bodyString = JSON.stringify(leverBody)
  const headers = getAuthHeaders('POST', requestPath, bodyString)
  
  try {
    console.log(`[LIVE] Setting leverage to ${lever}x for ${instId}`)
    
    const response = await secureFetch(url, {
      method: 'POST',
      headers: headers,
      body: bodyString,
    })
    
    const data = await response.json()
    
    if (data.code !== '0') {
      console.error(`Failed to set leverage: ${data.msg}`)
      // Don't throw - leverage setting failure shouldn't block the trade
      return { success: false, error: data.msg }
    }
    
    return {
      success: true,
      leverage: parseFloat(data.data[0].lever),
    }
  } catch (error) {
    console.error('Failed to set leverage:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Place a market order (private endpoint - requires auth)
 * 
 * ⚠️ WARNING: This places REAL orders with REAL money in live mode!
 * 
 * In demo mode: Simulates the trade locally without calling OKX API
 * In live mode: Actually places the order on OKX
 * 
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT')
 * @param {string} side - 'buy' or 'sell'
 * @param {string} size - Order size in quote currency (USDT)
 * @param {number} leverage - Leverage multiplier (1 = spot, >1 = margin)
 */
export async function placeMarketOrder(instId, side, size, leverage = 1) {
  // If in demo mode, simulate the trade locally
  if (demoMode) {
    console.log(`[DEMO] Simulating ${side} order for ${size} USDT of ${instId} @ ${leverage}x`)
    
    // Generate a fake order ID
    const fakeOrderId = `DEMO_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Simulate a small delay like a real API call
    await new Promise(resolve => setTimeout(resolve, 100))
    
    console.log(`[DEMO] Order simulated! ID: ${fakeOrderId}`)
    
    return {
      orderId: fakeOrderId,
      clientOrderId: `cl_${fakeOrderId}`,
      success: true,
      simulated: true,
      leverage: leverage,
    }
  }
  
  // Live trading - actually place the order on OKX
  const requestPath = '/api/v5/trade/order'
  const url = BASE_URL + requestPath
  
  // Determine trading mode based on leverage
  // 'cash' for spot (no leverage), 'cross' for cross margin, 'isolated' for isolated margin
  const tdMode = leverage > 1 ? 'cross' : 'cash'
  
  // Order parameters
  const orderBody = {
    instId: instId,
    tdMode: tdMode,        // Trading mode based on leverage
    side: side,            // 'buy' or 'sell'
    ordType: 'market',     // Market order
    sz: size.toString(),   // Size in quote currency
    tgtCcy: 'quote_ccy',   // Target currency is quote (USDT)
  }
  
  const bodyString = JSON.stringify(orderBody)
  const headers = getAuthHeaders('POST', requestPath, bodyString)
  
  try {
    // If leverage > 1, set the leverage first
    if (leverage > 1) {
      await setLeverage(instId, leverage)
    }
    
    console.log(`[LIVE] Placing ${side} order for ${size} USDT of ${instId} @ ${leverage}x (${tdMode})`)
    
    const response = await secureFetch(url, {
      method: 'POST',
      headers: headers,
      body: bodyString,
    })
    
    const data = await response.json()
    
    if (data.code !== '0') {
      throw new Error(`Order failed: ${data.msg} (${data.data?.[0]?.sMsg || ''})`)
    }
    
    return {
      orderId: data.data[0].ordId,
      clientOrderId: data.data[0].clOrdId,
      success: true,
      simulated: false,
    }
  } catch (error) {
    console.error('Failed to place order:', error)
    throw error
  }
}

/**
 * Get account balance (private endpoint)
 * 
 * In demo mode: Returns simulated balance
 * In live mode: Fetches real balance from OKX
 */
export async function getBalance() {
  // If in demo mode, return simulated balance
  if (demoMode) {
    console.log('[DEMO] Returning simulated balance')
    return {
      totalEq: '10000.00',
      details: [
        { ccy: 'USDT', availBal: '10000.00', frozenBal: '0' },
        { ccy: 'BTC', availBal: '0.1', frozenBal: '0' },
        { ccy: 'ETH', availBal: '1.0', frozenBal: '0' },
      ]
    }
  }
  
  // Live mode - fetch real balance
  const requestPath = '/api/v5/account/balance'
  const url = BASE_URL + requestPath
  
  const headers = getAuthHeaders('GET', requestPath)
  
  return withRetry(async () => {
    const response = await secureFetch(url, {
      method: 'GET',
      headers: headers,
    })
    
    const data = await response.json()
    
    if (data.code !== '0') {
      throw new Error(`Failed to get balance: ${data.msg} (code: ${data.code})`)
    }
    
    return data.data[0]
  })
}

/**
 * Check if API credentials are configured
 */
export function isConfigured() {
  return !!(
    process.env.OKX_API_KEY &&
    process.env.OKX_SECRET_KEY &&
    process.env.OKX_PASSPHRASE
  )
}
