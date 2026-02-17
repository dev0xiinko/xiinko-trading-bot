'use client'

/**
 * 0xiinko v1.0.0 Trading Dashboard
 * 
 * Grid Layout:
 * - Left Sidebar: Account details, balance, controls
 * - Upper Right: Scanned pairs with signals
 * - Lower Right: Active positions
 * 
 * ⚠️ WARNING: This dashboard controls a bot that trades with REAL MONEY!
 */

import { useState, useEffect, useCallback } from 'react'

// Refresh intervals (increased to avoid rate limits)
const MARKET_REFRESH_INTERVAL = 15000  // 15 seconds (was 5s)
const BOT_CYCLE_INTERVAL = 60000       // 60 seconds (was 30s)

// Trading pairs to scan (reduced to avoid rate limits)
const TRADING_PAIRS = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'XRP-USDT',
]

export default function Dashboard() {
  // State
  const [mounted, setMounted] = useState(false)
  const [marketData, setMarketData] = useState(null)
  const [scannedPairs, setScannedPairs] = useState([])
  const [positions, setPositions] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [botRunning, setBotRunning] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [balance, setBalance] = useState({ total: '--', available: '--', currencies: [] })
  const [logs, setLogs] = useState([])
  const [lastUpdate, setLastUpdate] = useState('')
  const [demoMode, setDemoMode] = useState(false)
  const [tradeConfig, setTradeConfig] = useState({ margin: 10, leverage: 1, maxLeverage: 125 })
  const [pendingConfig, setPendingConfig] = useState({ margin: 10, leverage: 1 })
  const [configSaved, setConfigSaved] = useState(true)
  const [tradeHistory, setTradeHistory] = useState([])
  const [tradeStats, setTradeStats] = useState(null)
  const [activeTab, setActiveTab] = useState('positions') // 'positions', 'history', 'logs'

  // Handle hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  /**
   * Fetch market data for a single pair
   */
  const fetchPairData = useCallback(async (instId) => {
    try {
      const res = await fetch(`/api/market?instId=${instId}`)
      const data = await res.json()
      return data.success ? { ...data, instId } : null
    } catch (err) {
      return null
    }
  }, [])

  /**
   * Delay helper for rate limiting
   */
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  /**
   * Scan all trading pairs with rate limiting
   */
  const scanPairs = useCallback(async () => {
    setScanning(true)
    try {
      // Fetch pairs sequentially with delay to avoid rate limits
      const results = []
      for (const pair of TRADING_PAIRS) {
        const data = await fetchPairData(pair)
        results.push(data)
        await delay(200) // 200ms delay between each request
      }
      
      const validResults = results
        .filter(r => r !== null)
        .map(r => ({
          instId: r.instId,
          price: r.market?.price || 0,
          signal: r.analysis?.signal || 'WAIT',
          fastMA: r.analysis?.fastMA || 0,
          slowMA: r.analysis?.slowMA || 0,
          change24h: r.market?.high24h && r.market?.low24h 
            ? ((r.market.price - r.market.low24h) / r.market.low24h * 100).toFixed(2)
            : 0,
        }))
        .sort((a, b) => {
          // Sort by signal priority: BUY > SELL > WAIT
          const priority = { BUY: 0, SELL: 1, WAIT: 2 }
          return priority[a.signal] - priority[b.signal]
        })
      
      setScannedPairs(validResults)
      setLastUpdate(new Date().toLocaleTimeString())
      
      // Update main market data from BTC
      const btcData = results.find(r => r?.instId === 'BTC-USDT')
      if (btcData) {
        setMarketData(btcData)
        setBotRunning(btcData.bot?.isRunning || false)
        setLogs(btcData.bot?.logs || [])
      }
      
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setScanning(false)
    }
  }, [fetchPairData])

  /**
   * Fetch account balance
   */
  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/account')
      const data = await res.json()
      
      if (data.success) {
        setBalance({
          total: data.balance.total,
          available: data.balance.available,
          currencies: data.balance.currencies || [],
        })
      }
    } catch (err) {
      console.error('Failed to fetch balance:', err)
    }
  }, [])

  /**
   * Fetch settings (demo mode)
   */
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      if (data.success) {
        setDemoMode(data.settings.demoMode)
        if (data.settings.tradeConfig) {
          setTradeConfig(data.settings.tradeConfig)
          setPendingConfig({
            margin: data.settings.tradeConfig.margin || data.settings.tradeConfig.tradeSize,
            leverage: data.settings.tradeConfig.leverage,
          })
          setConfigSaved(true)
        }
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    }
  }, [])

  /**
   * Toggle demo mode
   */
  const toggleDemoMode = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoMode: !demoMode }),
      })
      const data = await res.json()
      if (data.success) {
        setDemoMode(data.settings.demoMode)
      }
    } catch (err) {
      console.error('Failed to toggle demo mode:', err)
    }
  }

  /**
   * Update pending config (local state only, not saved yet)
   */
  const updatePendingConfig = (field, value) => {
    setPendingConfig(prev => ({ ...prev, [field]: value }))
    setConfigSaved(false)
  }

  /**
   * Save trade configuration to server
   */
  const saveConfig = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          margin: pendingConfig.margin,
          leverage: pendingConfig.leverage,
        }),
      })
      const data = await res.json()
      if (data.success && data.settings.tradeConfig) {
        setTradeConfig(data.settings.tradeConfig)
        setPendingConfig({
          margin: data.settings.tradeConfig.margin,
          leverage: data.settings.tradeConfig.leverage,
        })
        setConfigSaved(true)
      }
    } catch (err) {
      console.error('Failed to save config:', err)
    }
  }

  /**
   * Fetch trade history and stats
   */
  const fetchTradeHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/trades?mode=${demoMode ? 'demo' : 'live'}&limit=20`)
      const data = await res.json()
      if (data.success) {
        setTradeHistory(data.trades || [])
        setTradeStats(data.stats || null)
      }
    } catch (err) {
      console.error('Failed to fetch trade history:', err)
    }
  }, [demoMode])

  /**
   * Clear trade history
   */
  const clearTradeHistory = async () => {
    if (!confirm(`Clear all ${demoMode ? 'demo' : 'live'} trade history?`)) return
    try {
      await fetch(`/api/trades?mode=${demoMode ? 'demo' : 'live'}`, { method: 'DELETE' })
      await fetchTradeHistory()
    } catch (err) {
      console.error('Failed to clear trade history:', err)
    }
  }

  /**
   * Fetch bot state
   */
  const fetchBotState = useCallback(async () => {
    try {
      const res = await fetch('/api/bot')
      const data = await res.json()
      
      if (data.success) {
        setBotRunning(data.state?.isRunning || false)
        setLogs(data.state?.logs || [])
      }
    } catch (err) {
      console.error('Failed to fetch bot state:', err)
    }
  }, [])

  /**
   * Fetch active positions with current prices
   */
  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/positions?updatePrices=true')
      const data = await res.json()
      
      if (data.success) {
        setPositions(data.positions || [])
      }
    } catch (err) {
      console.error('Failed to fetch positions:', err)
    }
  }, [])

  /**
   * Close a specific position
   */
  const closePosition = async (positionId) => {
    try {
      const res = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', positionId }),
      })
      const data = await res.json()
      
      if (data.success) {
        setPositions(data.positions || [])
      } else {
        console.error('Failed to close position:', data.error)
      }
    } catch (err) {
      console.error('Failed to close position:', err)
    }
  }

  /**
   * Close all positions
   */
  const closeAllPositions = async () => {
    try {
      const res = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'closeAll' }),
      })
      const data = await res.json()
      
      if (data.success) {
        setPositions([])
      }
    } catch (err) {
      console.error('Failed to close all positions:', err)
    }
  }

  /**
   * Toggle bot on/off
   */
  const toggleBot = async () => {
    setToggling(true)
    try {
      const action = botRunning ? 'stop' : 'start'
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      
      if (data.success) {
        setBotRunning(data.state.isRunning)
        await scanPairs()
      } else {
        setError(data.error)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setToggling(false)
    }
  }

  /**
   * Trigger a manual scan
   */
  const triggerScan = () => {
    scanPairs()
  }

  /**
   * Trigger bot cycle
   */
  const triggerBotCycle = useCallback(async () => {
    if (!botRunning) return
    try {
      await fetch('/api/bot?action=cycle')
      await scanPairs()
    } catch (err) {
      console.error('Bot cycle error:', err)
    }
  }, [botRunning, scanPairs])

  // Initial load
  useEffect(() => {
    scanPairs()
    fetchBotState()
    fetchBalance()
    fetchSettings()
    fetchTradeHistory()
    fetchPositions()
  }, [])

  // Refresh balance periodically (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(fetchBalance, 30000)
    return () => clearInterval(interval)
  }, [fetchBalance])

  // Refresh positions periodically (every 5 seconds for real-time prices)
  useEffect(() => {
    const interval = setInterval(fetchPositions, 5000)
    return () => clearInterval(interval)
  }, [fetchPositions])

  // Refresh trade history when demo mode changes
  useEffect(() => {
    fetchTradeHistory()
  }, [demoMode, fetchTradeHistory])

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(scanPairs, MARKET_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [scanPairs])

  // Bot cycle
  useEffect(() => {
    if (botRunning) {
      const interval = setInterval(triggerBotCycle, BOT_CYCLE_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [botRunning, triggerBotCycle])

  // Helpers
  const formatPrice = (price) => {
    if (price === null || price === undefined || price === '') return '--'
    const numPrice = typeof price === 'string' ? parseFloat(price) : price
    if (isNaN(numPrice)) return '--'
    
    // Use more decimal places for smaller prices
    const decimals = numPrice < 1 ? 6 : numPrice < 100 ? 4 : 2
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals,
    }).format(numPrice)
  }

  const formatTime = (timestamp) => {
    if (!timestamp || !mounted) return '--'
    return new Date(timestamp).toLocaleTimeString()
  }

  const getSignalClass = (signal) => {
    switch (signal) {
      case 'BUY': return 'text-[#0f0] border-[#0f0]'
      case 'SELL': return 'text-[#f00] border-[#f00]'
      default: return 'text-[#666] border-[#666]'
    }
  }

  const getSignalBg = (signal) => {
    switch (signal) {
      case 'BUY': return 'border-l-[#0f0]'
      case 'SELL': return 'border-l-[#f00]'
      default: return 'border-l-[#444]'
    }
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      {/* Main Grid Layout */}
      <div className="h-screen grid grid-cols-[300px_1fr] grid-rows-1">
        
        {/* ==================== LEFT SIDEBAR ==================== */}
        <aside className="bg-black border-r border-white flex flex-col overflow-y-auto">
          
          {/* Logo/Title */}
          <div className="p-4 border-b border-white">
            <div className="text-[#0ff] text-sm"> ┌─────────────────────────┐</div>
            <h1 className="text-lg font-bold text-white px-1">│ 0xiinko <span className="text-[#0ff]">v1.0.0</span></h1>
            
            <div className="text-[#0ff] text-sm"> └─────────────────────────┘</div>
            
            {/* Demo Mode Badge */}
            <div className="mt-2">
              <span className={`inline-block px-2 py-1 text-xs font-bold border ${
                demoMode 
                  ? 'text-[#ff0] border-[#ff0]' 
                  : 'text-[#f00] border-[#f00]'
              }`}>
                {demoMode ? '[DEMO]' : '[LIVE]'}
              </span>
            </div>
          </div>

          {/* Demo Mode Toggle */}
          <div className="p-4 border-b border-[#444]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs text-[#666] uppercase tracking-wider">
                  TRADING MODE
                </h2>
                <p className="text-xs text-[#888] mt-1">
                  {demoMode ? 'Paper trading' : 'Real money'}
                </p>
              </div>
              <button
                onClick={toggleDemoMode}
                className={`px-3 py-1 text-xs font-bold border ${
                  demoMode 
                    ? 'text-[#ff0] border-[#ff0] hover:bg-[#ff0] hover:text-black' 
                    : 'text-[#f00] border-[#f00] hover:bg-[#f00] hover:text-black'
                }`}
              >
                {demoMode ? 'DEMO' : 'LIVE'}
              </button>
            </div>
          </div>

          {/* Account Balance */}
          <div className="p-4 border-b border-[#444]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs text-[#666] uppercase tracking-wider">
                BALANCE
              </h2>
              <button 
                onClick={fetchBalance}
                className="text-xs text-[#0ff] hover:underline"
              >
                [REFRESH]
              </button>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[#888]">Total:</span>
                <span className="text-lg font-bold text-[#0f0]">${balance.total}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#888]">Avail:</span>
                <span className="text-[#0f0]">${balance.available}</span>
              </div>
              
            </div>
          </div>

          {/* Bot Status */}
          <div className="p-4 border-b border-[#444]">
            <h2 className="text-xs text-[#666] uppercase tracking-wider mb-3">
              STATUS
            </h2>
            <div className="flex items-center gap-3 mb-2">
              <span className={`${botRunning ? 'text-[#0f0]' : 'text-[#666]'}`}>
                {botRunning ? '●' : '○'}
              </span>
              <span className={`font-bold ${botRunning ? 'text-[#0f0]' : 'text-[#666]'}`}>
                {botRunning ? 'RUNNING' : 'STOPPED'}
              </span>
            </div>
            
            {marketData?.bot?.isInCooldown && (
              <div className="text-xs text-[#ff0]">
                COOLDOWN: {marketData.bot.cooldownRemaining}s
              </div>
            )}
          </div>

          {/* Control Buttons */}
          <div className="p-4 border-b border-[#444] space-y-2">
            <h2 className="text-xs text-[#666] uppercase tracking-wider mb-3">
              CONTROLS
            </h2>
            
            <button
              onClick={toggleBot}
              disabled={toggling}
              className={`w-full py-2 px-4 text-sm font-bold border transition-all ${
                botRunning
                  ? 'text-[#f00] border-[#f00] hover:bg-[#f00] hover:text-black'
                  : 'text-[#0f0] border-[#0f0] hover:bg-[#0f0] hover:text-black'
              } ${toggling ? 'opacity-50' : ''}`}
            >
              {toggling ? 'PROCESSING...' : (botRunning ? '[ STOP BOT ]' : '[ START BOT ]')}
            </button>

            <button
              onClick={triggerScan}
              disabled={scanning}
              className={`w-full py-2 px-4 text-sm font-bold border text-[#0ff] border-[#0ff] hover:bg-[#0ff] hover:text-black ${scanning ? 'opacity-50' : ''}`}
            >
              {scanning ? 'SCANNING...' : '[ SCAN MARKETS ]'}
            </button>

            <button
              onClick={triggerBotCycle}
              disabled={!botRunning}
              className={`w-full py-1 px-4 text-xs border text-[#f0f] border-[#f0f] hover:bg-[#f0f] hover:text-black ${!botRunning ? 'opacity-50' : ''}`}
            >
              [ FORCE CYCLE ]
            </button>
          </div>

          {/* Trade Configuration */}
          <div className="p-4 border-b border-[#444]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs text-[#666] uppercase tracking-wider">
                TRADE CONFIG
              </h2>
              {!configSaved && (
                <span className="text-[#ff0] text-xs">● UNSAVED</span>
              )}
            </div>
            
            {/* Margin */}
            <div className="mb-3">
              <label className="text-xs text-[#888] block mb-1">
                MARGIN (USDT)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={pendingConfig.margin}
                  onChange={(e) => updatePendingConfig('margin', parseFloat(e.target.value) || 0)}
                  min="1"
                  step="1"
                  className="flex-1 bg-black border border-[#444] text-white px-2 py-1 text-sm font-mono focus:border-[#0ff] focus:outline-none"
                />
                <span className="text-[#666] text-xs">USDT</span>
              </div>
              <div className="flex gap-1 mt-1">
                {[10, 25, 50, 100, 500, 1000].map(size => (
                  <button
                    key={size}
                    onClick={() => updatePendingConfig('margin', size)}
                    className={`px-2 py-0.5 text-xs border ${
                      pendingConfig.margin === size 
                        ? 'border-[#0ff] text-[#0ff]' 
                        : 'border-[#333] text-[#666] hover:border-[#666]'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {/* Position value preview */}
              <div className="text-xs text-[#666] mt-1">
                Position: ${(pendingConfig.margin * pendingConfig.leverage).toLocaleString()} USDT
              </div>
            </div>
            
            {/* Leverage */}
            <div className="mb-3">
              <label className="text-xs text-[#888] block mb-1">
                LEVERAGE
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  value={pendingConfig.leverage}
                  onChange={(e) => updatePendingConfig('leverage', parseInt(e.target.value))}
                  min="1"
                  max={tradeConfig.maxLeverage || 125}
                  className="flex-1 accent-[#0ff]"
                />
                <span className={`font-mono text-sm font-bold w-12 text-right ${
                  pendingConfig.leverage > 50 ? 'text-[#f00]' : 
                  pendingConfig.leverage > 10 ? 'text-[#ff0]' : 'text-[#0f0]'
                }`}>
                  {pendingConfig.leverage}x
                </span>
              </div>
              <div className="flex gap-1 mt-1">
                {[1, 5, 10, 25, 50, 100].map(lev => (
                  <button
                    key={lev}
                    onClick={() => updatePendingConfig('leverage', lev)}
                    className={`px-1.5 py-0.5 text-xs border ${
                      pendingConfig.leverage === lev 
                        ? 'border-[#0ff] text-[#0ff]' 
                        : 'border-[#333] text-[#666] hover:border-[#666]'
                    }`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
              {pendingConfig.leverage > 10 && (
                <p className="text-[#f00] text-xs mt-2">
                  ⚠ HIGH LEVERAGE RISK
                </p>
              )}
            </div>

            {/* Save Button */}
            <button
              onClick={saveConfig}
              disabled={configSaved}
              className={`w-full py-2 px-4 text-sm font-bold border transition-all ${
                configSaved
                  ? 'text-[#444] border-[#333] cursor-not-allowed'
                  : 'text-[#0f0] border-[#0f0] hover:bg-[#0f0] hover:text-black'
              }`}
            >
              {configSaved ? '[ CONFIG SAVED ]' : '[ SAVE CONFIG ]'}
            </button>
          </div>

          {/* Strategy Info */}
          <div className="p-4 border-b border-[#444]">
            <h2 className="text-xs text-[#666] uppercase tracking-wider mb-2">
              STRATEGY
            </h2>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-[#666]">Type:</span>
                <span className="text-white">MA_CROSSOVER</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">Fast:</span>
                <span className="text-[#0ff]">MA(9)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">Slow:</span>
                <span className="text-[#f0f]">MA(21)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">Margin:</span>
                <span className="text-white">{tradeConfig.margin} USDT</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">Leverage:</span>
                <span className={tradeConfig.leverage > 10 ? 'text-[#f00]' : tradeConfig.leverage > 1 ? 'text-[#ff0]' : 'text-white'}>
                  {tradeConfig.leverage}x
                </span>
              </div>
              <div className="flex justify-between border-t border-[#333] pt-1 mt-1">
                <span className="text-[#666]">Position:</span>
                <span className="text-[#0ff]">${(tradeConfig.margin * tradeConfig.leverage).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Logs (scrollable, takes remaining space) */}
          <div className="flex-1 p-4 overflow-hidden flex flex-col min-h-0">
            <h2 className="text-xs text-[#666] uppercase tracking-wider mb-2">
              LOGS
            </h2>
            <div className="flex-1 overflow-y-auto space-y-0.5 text-xs">
              {logs.length > 0 ? (
                logs.slice(0, 15).map((log, idx) => (
                  <div
                    key={idx}
                    className={`${
                      log.type === 'error' ? 'text-[#f00]' :
                      log.type === 'trade' ? 'text-[#0f0]' :
                      log.type === 'signal' ? 'text-[#0ff]' :
                      'text-[#666]'
                    }`}
                  >
                    <span className="text-[#444]">{formatTime(log.timestamp)}</span> {log.message}
                  </div>
                ))
              ) : (
                <p className="text-[#444]">No logs yet...</p>
              )}
              <span className="text-[#0f0] cursor-blink">_</span>
            </div>
          </div>

          {/* Warning Footer */}
          <div className={`p-2 border-t ${demoMode ? 'border-[#ff0]' : 'border-[#f00]'}`}>
            <p className={`text-xs text-center ${demoMode ? 'text-[#ff0]' : 'text-[#f00]'}`}>
              {demoMode ? '[ DEMO MODE - NO REAL MONEY ]' : '[ ! LIVE TRADING ! ]'}
            </p>
          </div>
        </aside>

        {/* ==================== MAIN CONTENT ==================== */}
        <main className="flex flex-col overflow-hidden bg-black">
          
          {/* ==================== UPPER: SCANNED PAIRS ==================== */}
          <section className="flex-1 border-b border-white overflow-hidden flex flex-col">
            <div className="p-3 border-b border-[#444] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">MARKET SCANNER</h2>
                <p className="text-xs text-[#666]">Sorted by signal strength</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className={`${scanning ? 'text-[#0ff]' : 'text-[#0f0]'}`}>
                  {scanning ? '◌' : '●'}
                </span>
                <span className="text-[#666]">
                  {scanning ? 'SCANNING...' : `UPD: ${lastUpdate || '--'}`}
                </span>
              </div>
            </div>

            {error && (
              <div className="mx-3 mt-3 p-2 border border-[#f00] text-[#f00] text-xs">
                ERROR: {error}
              </div>
            )}

            <div className="flex-1 overflow-auto p-3">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-[#666]">Loading markets...<span className="cursor-blink">_</span></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {scannedPairs.map((pair) => (
                    <div
                      key={pair.instId}
                      className={`bg-black border border-[#444] p-3 border-l-4 ${getSignalBg(pair.signal)} hover:border-white transition-all cursor-pointer`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-white">{pair.instId}</span>
                        <span className={`px-2 py-0.5 text-xs font-bold border ${getSignalClass(pair.signal)}`}>
                          {pair.signal}
                        </span>
                      </div>
                      
                      <div className="text-xl font-bold text-[#0f0] mb-2 font-mono">
                        {formatPrice(pair.price)}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-[#666]">MA(9):</span>
                          <p className="text-[#0ff]">{formatPrice(pair.fastMA)}</p>
                        </div>
                        <div>
                          <span className="text-[#666]">MA(21):</span>
                          <p className="text-[#f0f]">{formatPrice(pair.slowMA)}</p>
                        </div>
                      </div>
                      
                      <div className="mt-2 pt-2 border-t border-[#333] flex justify-between items-center text-xs">
                        <span className="text-[#666]">24H:</span>
                        <span className={`font-bold ${parseFloat(pair.change24h) >= 0 ? 'text-[#0f0]' : 'text-[#f00]'}`}>
                          {pair.change24h >= 0 ? '+' : ''}{pair.change24h}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ==================== LOWER: POSITIONS, TRADE HISTORY & LOGS ==================== */}
          <section className="h-[320px] flex flex-col">
            {/* Tabs */}
            <div className="p-3 border-b border-[#444] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('positions')}
                  className={`px-3 py-1 text-sm font-bold border ${
                    activeTab === 'positions'
                      ? 'text-black bg-white border-white' 
                      : 'text-[#666] border-[#444] hover:border-white hover:text-white'
                  }`}
                >
                  POSITIONS
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-3 py-1 text-sm font-bold border ${
                    activeTab === 'history'
                      ? 'text-black bg-white border-white' 
                      : 'text-[#666] border-[#444] hover:border-white hover:text-white'
                  }`}
                >
                  HISTORY
                </button>
                <button
                  onClick={() => setActiveTab('logs')}
                  className={`px-3 py-1 text-sm font-bold border ${
                    activeTab === 'logs'
                      ? 'text-black bg-white border-white' 
                      : 'text-[#666] border-[#444] hover:border-white hover:text-white'
                  }`}
                >
                  LOGS
                </button>
              </div>
              
              <div className="flex items-center gap-3 text-xs">
                {activeTab === 'positions' && (
                  <>
                    <button
                      onClick={fetchPositions}
                      className="text-[#0ff] hover:underline"
                    >
                      [REFRESH]
                    </button>
                    {positions.length > 0 && (
                      <button
                        onClick={closeAllPositions}
                        className="text-[#f00] hover:underline"
                      >
                        [CLOSE ALL]
                      </button>
                    )}
                    <span className="text-[#666]">{positions.length} open</span>
                  </>
                )}
                {activeTab === 'history' && (
                  <>
                    <button
                      onClick={fetchTradeHistory}
                      className="text-[#0ff] hover:underline"
                    >
                      [REFRESH]
                    </button>
                    <button
                      onClick={clearTradeHistory}
                      className="text-[#f00] hover:underline"
                    >
                      [CLEAR]
                    </button>
                  </>
                )}
                {activeTab === 'logs' && (
                  <span className="text-[#666]">{logs.length} entries</span>
                )}
                <span className={`px-2 py-0.5 border ${
                  demoMode ? 'text-[#ff0] border-[#ff0]' : 'text-[#f00] border-[#f00]'
                }`}>
                  {demoMode ? 'DEMO' : 'LIVE'}
                </span>
              </div>
            </div>

            {/* Trade Stats Summary */}
            {activeTab === 'history' && tradeStats && (
              <div className="px-3 py-2 border-b border-[#333] flex items-center gap-6 text-xs text-[#888]">
                <span>TRADES: <span className="text-white">{tradeStats.totalTrades}</span></span>
                <span>WIN: <span className={parseFloat(tradeStats.winRate) >= 50 ? 'text-[#0f0]' : 'text-[#f00]'}>{tradeStats.winRate}%</span></span>
                <span>P/L: <span className={parseFloat(tradeStats.totalPnL) >= 0 ? 'text-[#0f0]' : 'text-[#f00]'}>${tradeStats.totalPnL}</span></span>
                <span>BUY: <span className="text-[#0f0]">{tradeStats.buyTrades}</span></span>
                <span>SELL: <span className="text-[#f00]">{tradeStats.sellTrades}</span></span>
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {activeTab === 'positions' ? (
                /* Active Positions */
                positions.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead className="bg-[#111] text-[#666] uppercase sticky top-0">
                      <tr>
                        <th className="text-left p-2 border-b border-[#444]">PAIR</th>
                        <th className="text-left p-2 border-b border-[#444]">MODE</th>
                        <th className="text-left p-2 border-b border-[#444]">SIDE</th>
                        <th className="text-right p-2 border-b border-[#444]">SIZE</th>
                        <th className="text-right p-2 border-b border-[#444]">LEV</th>
                        <th className="text-right p-2 border-b border-[#444]">ENTRY</th>
                        <th className="text-right p-2 border-b border-[#444]">CURRENT</th>
                        <th className="text-right p-2 border-b border-[#444]">P/L %</th>
                        <th className="text-right p-2 border-b border-[#444]">P/L USDT</th>
                        <th className="text-center p-2 border-b border-[#444]">ACT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos) => {
                        const leverage = pos.leverage || 1
                        const pnlPercent = pos.pnl ? parseFloat(pos.pnl) : (
                          (pos.side === 'buy' 
                            ? ((pos.currentPrice - pos.entryPrice) / pos.entryPrice * 100)
                            : ((pos.entryPrice - pos.currentPrice) / pos.entryPrice * 100)
                          ) * leverage
                        )
                        const pnlUsdt = pos.pnlUsdt ? parseFloat(pos.pnlUsdt) : (
                          (pos.side === 'buy'
                            ? ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * parseFloat(pos.size)
                            : ((pos.entryPrice - pos.currentPrice) / pos.entryPrice) * parseFloat(pos.size)
                          ) * leverage
                        )
                        
                        return (
                          <tr key={pos.id} className="border-b border-[#222] hover:bg-[#111]">
                            <td className="p-2 font-bold text-white">{pos.instId}</td>
                            <td className="p-2">
                              <span className={pos.mode === 'demo' ? 'text-[#ff0]' : 'text-[#f00]'}>
                                {(pos.mode || 'live').toUpperCase()}
                              </span>
                            </td>
                            <td className="p-2">
                              <span className={pos.side === 'buy' ? 'text-[#0f0]' : 'text-[#f00]'}>
                                {pos.side?.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-2 text-right text-[#888]">{pos.size}</td>
                            <td className={`p-2 text-right font-bold ${
                              leverage > 10 ? 'text-[#f00]' : leverage > 1 ? 'text-[#ff0]' : 'text-[#888]'
                            }`}>
                              {leverage}x
                            </td>
                            <td className="p-2 text-right text-[#888]">{formatPrice(pos.entryPrice)}</td>
                            <td className="p-2 text-right text-white">{formatPrice(pos.currentPrice)}</td>
                            <td className={`p-2 text-right font-bold ${pnlPercent >= 0 ? 'text-[#0f0]' : 'text-[#f00]'}`}>
                              {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                            </td>
                            <td className={`p-2 text-right font-bold ${pnlUsdt >= 0 ? 'text-[#0f0]' : 'text-[#f00]'}`}>
                              {pnlUsdt >= 0 ? '+' : ''}{pnlUsdt.toFixed(4)}
                            </td>
                            <td className="p-2 text-center">
                              <button 
                                onClick={() => closePosition(pos.id)}
                                className="px-2 py-0.5 text-[#f00] border border-[#f00] hover:bg-[#f00] hover:text-black"
                              >
                                CLOSE
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#444]">
                    <div className="text-center">
                      <p>No active positions</p>
                      <p className="text-xs mt-1">Trades will appear here when bot executes_</p>
                    </div>
                  </div>
                )
              ) : activeTab === 'history' ? (
                /* Trade History */
                tradeHistory.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead className="bg-[#111] text-[#666] uppercase sticky top-0">
                      <tr>
                        <th className="text-left p-2 border-b border-[#444]">TIME</th>
                        <th className="text-left p-2 border-b border-[#444]">MODE</th>
                        <th className="text-left p-2 border-b border-[#444]">PAIR</th>
                        <th className="text-left p-2 border-b border-[#444]">SIDE</th>
                        <th className="text-right p-2 border-b border-[#444]">PRICE</th>
                        <th className="text-right p-2 border-b border-[#444]">SIZE</th>
                        <th className="text-left p-2 border-b border-[#444]">SIG</th>
                        <th className="text-left p-2 border-b border-[#444]">ORDER_ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeHistory.map((trade) => (
                        <tr key={trade.id} className="border-b border-[#222] hover:bg-[#111]">
                          <td className="p-2 text-[#666]">{formatTime(trade.timestamp)}</td>
                          <td className="p-2">
                            <span className={trade.mode === 'demo' ? 'text-[#ff0]' : 'text-[#f00]'}>
                              {trade.mode?.toUpperCase()}
                            </span>
                          </td>
                          <td className="p-2 font-bold text-white">{trade.instId}</td>
                          <td className="p-2">
                            <span className={trade.side === 'buy' ? 'text-[#0f0]' : 'text-[#f00]'}>
                              {trade.side?.toUpperCase()}
                            </span>
                          </td>
                          <td className="p-2 text-right text-white">{formatPrice(trade.price)}</td>
                          <td className="p-2 text-right text-[#888]">{trade.size}</td>
                          <td className="p-2">
                            <span className={getSignalClass(trade.signal)}>
                              {trade.signal}
                            </span>
                          </td>
                          <td className="p-2 text-[#444]">{trade.orderId?.slice(0, 12)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#444]">
                    <div className="text-center">
                      <p>No trade history</p>
                      <p className="text-xs mt-1">
                        {demoMode ? 'Demo trades recorded here_' : 'Live trades recorded here_'}
                      </p>
                    </div>
                  </div>
                )
              ) : (
                /* Logs Tab */
                logs.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {logs.map((log, index) => {
                      // Log can be object {timestamp, message, type} or string
                      const logMessage = typeof log === 'object' ? log.message : log
                      const logType = typeof log === 'object' ? log.type : 'info'
                      const logTime = typeof log === 'object' && log.timestamp 
                        ? new Date(log.timestamp).toLocaleTimeString() 
                        : ''
                      
                      // Determine color based on type
                      let colorClass = 'text-[#888]'
                      let prefix = '>'
                      
                      if (logType === 'error') {
                        colorClass = 'text-[#f00]'
                        prefix = '[ERR]'
                      } else if (logType === 'trade') {
                        colorClass = 'text-[#0f0]'
                        prefix = '[TRADE]'
                      } else if (logType === 'signal') {
                        colorClass = 'text-[#0ff]'
                        prefix = '[SIG]'
                      } else if (logType === 'warning') {
                        colorClass = 'text-[#ff0]'
                        prefix = '[WARN]'
                      } else {
                        colorClass = 'text-[#888]'
                        prefix = '[INFO]'
                      }
                      
                      return (
                        <div 
                          key={index} 
                          className={`font-mono text-xs hover:bg-[#111] px-2 py-0.5 flex items-start`}
                        >
                          <span className="text-[#333] mr-2 flex-shrink-0">{String(index + 1).padStart(3, '0')}</span>
                          <span className={`mr-2 flex-shrink-0 ${colorClass}`}>{prefix}</span>
                          {logTime && <span className="text-[#444] mr-2 flex-shrink-0">{logTime}</span>}
                          <span className={colorClass}>{logMessage}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#444]">
                    <div className="text-center">
                      <p>No logs available</p>
                      <p className="text-xs mt-1">Bot activity will be logged here_</p>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>

        </main>
      </div>
    </div>
  )
}
