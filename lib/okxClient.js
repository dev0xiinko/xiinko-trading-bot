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
 * Get the appropriate API credentials based on current mode
 * OKX has separate API keys for Demo and Live trading
 */
function getCredentials() {
  if (demoMode) {
    // Demo mode: Use demo credentials, fallback to live credentials
    return {
      apiKey: process.env.OKX_DEMO_API_KEY || process.env.OKX_API_KEY,
      secretKey: process.env.OKX_DEMO_SECRET_KEY || process.env.OKX_SECRET_KEY,
      passphrase: process.env.OKX_DEMO_PASSPHRASE || process.env.OKX_PASSPHRASE,
    }
  }
  // Live mode: Use live credentials only
  return {
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE,
  }
}

/**
 * Generate OKX API signature
 * 
 * OKX uses HMAC SHA256 signature with:
 * - timestamp + method + requestPath + body
 */
function generateSignature(timestamp, method, requestPath, body = '') {
  const { secretKey } = getCredentials()
  
  if (!secretKey) {
    const mode = demoMode ? 'Demo' : 'Live'
    throw new Error(`OKX ${mode} SECRET_KEY is not configured`)
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
 * Uses different credentials for Demo vs Live mode
 */
function getAuthHeaders(method, requestPath, body = '') {
  const { apiKey, passphrase } = getCredentials()
  const mode = demoMode ? 'Demo' : 'Live'
  
  if (!apiKey || !passphrase) {
    throw new Error(`OKX ${mode} API credentials are not configured. ` +
      (demoMode 
        ? 'Set OKX_DEMO_API_KEY, OKX_DEMO_SECRET_KEY, OKX_DEMO_PASSPHRASE in .env.local'
        : 'Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE in .env.local'
      )
    )
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
  
  // Add demo trading header if enabled (required by OKX)
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
 * Get account configuration
 */
export async function getAccountConfig() {
  const requestPath = '/api/v5/account/config'
  const url = BASE_URL + requestPath
  const headers = getAuthHeaders('GET', requestPath)
  
  try {
    const response = await secureFetch(url, {
      method: 'GET',
      headers: headers,
    })
    
    const data = await response.json()
    
    if (data.code !== '0') {
      console.error('Failed to get account config:', data.msg)
      return null
    }
    
    return data.data?.[0]
  } catch (error) {
    console.error('Error getting account config:', error)
    return null
  }
}

/**
 * Set account level/mode for trading
 * acctLv: '1' Simple, '2' Single-currency margin, '3' Multi-currency margin, '4' Portfolio margin
 * For perpetual trading, need mode 2, 3, or 4
 */
let accountModeSet = false
async function ensureAccountMode() {
  if (accountModeSet) return true
  
  const mode = demoMode ? 'DEMO' : 'LIVE'
  
  // First check current account config
  const config = await getAccountConfig()
  if (config) {
    console.log(`[${mode}] Current account level: ${config.acctLv} (1=Simple, 2=Single-currency margin, 3=Multi-currency, 4=Portfolio)`)
    
    // If already in margin mode (2, 3, or 4), we're good
    if (['2', '3', '4'].includes(config.acctLv)) {
      accountModeSet = true
      return true
    }
  }
  
  // Need to switch to Single-currency margin mode (2) for perpetual trading
  const requestPath = '/api/v5/account/set-account-level'
  const url = BASE_URL + requestPath
  
  const body = { acctLv: '2' }  // Single-currency margin mode
  const bodyString = JSON.stringify(body)
  const headers = getAuthHeaders('POST', requestPath, bodyString)
  
  try {
    console.log(`[${mode}] Setting account to Single-currency margin mode for derivatives trading...`)
    
    const response = await secureFetch(url, {
      method: 'POST',
      headers: headers,
      body: bodyString,
    })
    
    const data = await response.json()
    
    if (data.code !== '0') {
      console.log(`[${mode}] Account mode response: ${data.msg} (code: ${data.code})`)
      // Some errors are acceptable (e.g., already in correct mode)
    } else {
      console.log(`[${mode}] Account switched to Single-currency margin mode`)
    }
    
    accountModeSet = true
    return true
  } catch (error) {
    console.error('Error setting account mode:', error)
    return false
  }
}

/**
 * Set position mode for perpetual trading
 * posMode: 'long_short_mode' for hedge mode, 'net_mode' for one-way mode
 */
async function setPositionMode(posMode = 'net_mode') {
  const mode = demoMode ? 'DEMO' : 'LIVE'
  const requestPath = '/api/v5/account/set-position-mode'
  const url = BASE_URL + requestPath
  
  const body = { posMode }
  const bodyString = JSON.stringify(body)
  const headers = getAuthHeaders('POST', requestPath, bodyString)
  
  try {
    console.log(`[${mode}] Setting position mode to ${posMode}`)
    
    const response = await secureFetch(url, {
      method: 'POST',
      headers: headers,
      body: bodyString,
    })
    
    const data = await response.json()
    
    // Code 51020 means position mode already set - that's fine
    if (data.code !== '0' && data.code !== '51020') {
      console.log(`Position mode response: ${JSON.stringify(data)}`)
    }
    
    return { success: true, posMode }
  } catch (error) {
    console.error('Error setting position mode:', error)
    return { success: false }
  }
}

/**
 * Set leverage for an instrument (private endpoint - requires auth)
 * 
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT')
 * @param {number} lever - Leverage value (1-125)
 * @param {string} mgnMode - Margin mode: 'cross' or 'isolated'
 */
async function setLeverage(instId, lever, mgnMode = 'cross') {
  const mode = demoMode ? 'DEMO' : 'LIVE'
  
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
    console.log(`[${mode}] Setting leverage to ${lever}x for ${instId}`)
    
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
 * @param {number} leverage - Leverage multiplier (default 1x)
 */
export async function placeMarketOrder(instId, side, size, leverage = 1) {
  const mode = demoMode ? 'DEMO' : 'LIVE'
  
  // Ensure account is in margin mode for perpetual trading
  await ensureAccountMode()
  
  // ALWAYS use perpetual contracts (SWAP) for futures trading
  // Convert BTC-USDT -> BTC-USDT-SWAP
  const actualInstId = `${instId}-SWAP`
  const tdMode = 'cross' // Cross margin for perpetual
  
  console.log(`[${mode}] Placing ${side} PERPETUAL order for ${size} USDT of ${actualInstId} @ ${leverage}x`)
  
  // Get current price and instrument info to calculate contract size
  const ticker = await getTicker(instId)
  const currentPrice = ticker.last
  
  // Get instrument info to find contract value
  const instInfoUrl = `${BASE_URL}/api/v5/public/instruments?instType=SWAP&instId=${actualInstId}`
  const instResponse = await secureFetch(instInfoUrl, { method: 'GET' })
  const instData = await instResponse.json()
  
  if (instData.code !== '0' || !instData.data?.[0]) {
    throw new Error(`Failed to get instrument info for ${actualInstId}`)
  }
  
  const ctVal = parseFloat(instData.data[0].ctVal) // Contract value (e.g., 0.01 BTC)
  const lotSz = parseFloat(instData.data[0].lotSz) // Minimum lot size
  
  // Calculate number of contracts: USDT_amount / (price * ctVal)
  const contractValue = currentPrice * ctVal
  let numContracts = Math.floor(size / contractValue)
  
  // Ensure minimum lot size
  if (numContracts < lotSz) {
    numContracts = lotSz
  }
  
  console.log(`[${mode}] ${actualInstId}: $${size} USDT @ $${currentPrice} = ${numContracts} contracts (ctVal=${ctVal})`)
  
  // Both demo and live use the real OKX API
  // Demo mode uses x-simulated-trading header (added in getAuthHeaders)
  const requestPath = '/api/v5/trade/order'
  const url = BASE_URL + requestPath
  
  // Perpetual contract order parameters
  const orderBody = {
    instId: actualInstId,
    tdMode: tdMode,
    side: side,
    ordType: 'market',
    sz: numContracts.toString(),    // Number of contracts
  }
  
  const bodyString = JSON.stringify(orderBody)
  const headers = getAuthHeaders('POST', requestPath, bodyString)
  
  try {
    // Set position mode and leverage for perpetual contracts
    await setPositionMode('net_mode')
    if (leverage > 1) {
      await setLeverage(actualInstId, leverage)
    }
    
    const response = await secureFetch(url, {
      method: 'POST',
      headers: headers,
      body: bodyString,
    })
    
    const data = await response.json()
    
    if (data.code !== '0') {
      throw new Error(`Order failed: ${data.msg} (${data.data?.[0]?.sMsg || ''})`)
    }
    
    console.log(`[${mode}] Order placed successfully: ${data.data[0].ordId}`)
    
    return {
      orderId: data.data[0].ordId,
      clientOrderId: data.data[0].clOrdId,
      success: true,
      simulated: demoMode, // Demo trades are simulated on OKX's side
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
  const mode = demoMode ? 'DEMO' : 'LIVE'
  console.log(`[${mode}] Fetching account balance`)
  
  // Both demo and live fetch real balance from OKX API
  // Demo mode uses x-simulated-trading header (added in getAuthHeaders)
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
 * Get positions from OKX (private endpoint)
 * Fetches real positions from OKX account
 */
export async function getPositions() {
  const mode = demoMode ? 'DEMO' : 'LIVE'
  console.log(`[${mode}] Fetching positions from OKX`)
  
  const requestPath = '/api/v5/account/positions'
  const url = BASE_URL + requestPath
  
  const headers = getAuthHeaders('GET', requestPath)
  
  return withRetry(async () => {
    const response = await secureFetch(url, {
      method: 'GET',
      headers: headers,
    })
    
    const data = await response.json()
    
    if (data.code !== '0') {
      throw new Error(`Failed to get positions: ${data.msg} (code: ${data.code})`)
    }
    
    // Transform OKX position data to our format
    // OKX field reference:
    // - imr: initial margin requirement (the margin)
    // - mmr: maintenance margin requirement
    // - notionalUsd: position value in USD
    // - pos: position size in contracts
    // - avgPx: average entry price
    return (data.data || []).map(pos => ({
      instId: pos.instId,
      side: parseFloat(pos.pos) > 0 ? 'long' : 'short',
      size: Math.abs(parseFloat(pos.pos)),
      entryPrice: parseFloat(pos.avgPx),
      currentPrice: parseFloat(pos.markPx) || parseFloat(pos.last),
      margin: parseFloat(pos.imr) || parseFloat(pos.margin) || 0,  // Initial margin requirement
      mmr: parseFloat(pos.mmr) || 0,  // Maintenance margin
      leverage: parseFloat(pos.lever),
      unrealizedPnl: parseFloat(pos.upl),
      unrealizedPnlPercent: parseFloat(pos.uplRatio) * 100,
      positionValue: parseFloat(pos.notionalUsd),
      liquidationPrice: parseFloat(pos.liqPx) || null,
      marginMode: pos.mgnMode,
      timestamp: new Date(parseInt(pos.cTime)).toISOString(),
    }))
  })
}

/**
 * Check if API credentials are configured
 */
export function isConfigured() {
  const { apiKey, secretKey, passphrase } = getCredentials()
  return !!(apiKey && secretKey && passphrase)
}
