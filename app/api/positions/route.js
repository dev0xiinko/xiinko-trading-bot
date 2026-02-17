/**
 * Positions API Route
 * 
 * Endpoints:
 * - GET: Get all active positions from OKX
 * - POST: Close a position or update prices
 */

import { NextResponse } from 'next/server'
import { getPositions as getLocalPositions, closePosition, updateMarketPrice, clearPositions, addLog } from '@/lib/state'
import { getTicker, isDemoMode, getPositions as getOkxPositions } from '@/lib/okxClient'
import { recordTrade } from '@/lib/tradeLog'

/**
 * GET /api/positions
 * 
 * Fetch all active positions from OKX (real positions)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const source = searchParams.get('source') || 'okx' // 'okx' or 'local'
    
    // Fetch real positions from OKX
    if (source === 'okx') {
      try {
        const okxPositions = await getOkxPositions()
        
        // Format positions for display
        const formattedPositions = okxPositions.map(pos => ({
          id: `${pos.instId}_${pos.side}`,
          instId: pos.instId.replace('-SWAP', ''), // Display without -SWAP suffix
          instIdFull: pos.instId,
          side: pos.side,
          size: pos.positionValue || pos.margin * pos.leverage,
          entryPrice: pos.entryPrice,
          currentPrice: pos.currentPrice,
          leverage: pos.leverage,
          margin: pos.margin,
          pnl: pos.unrealizedPnlPercent?.toFixed(2) || '0.00',
          pnlUsdt: pos.unrealizedPnl?.toFixed(4) || '0.0000',
          liquidationPrice: pos.liquidationPrice,
          marginMode: pos.marginMode,
          timestamp: pos.timestamp,
          source: 'okx',
        }))
        
        return NextResponse.json({
          success: true,
          positions: formattedPositions,
          count: formattedPositions.length,
          source: 'okx',
          mode: isDemoMode() ? 'demo' : 'live',
        })
      } catch (err) {
        console.error('Failed to fetch OKX positions:', err.message)
        // Fall back to local positions if OKX fetch fails
      }
    }
    
    // Fallback: Use local positions
    let positions = getLocalPositions()
    
    // Store fetched prices for accurate calculation
    const currentPrices = {}
    
    // Fetch current prices for all positions
    if (positions.length > 0) {
      const instIds = [...new Set(positions.map(p => p.instId))]
      
      for (const instId of instIds) {
        try {
          const ticker = await getTicker(instId)
          if (ticker && ticker.last !== undefined) {
            const price = parseFloat(ticker.last)
            if (!isNaN(price) && price > 0) {
              currentPrices[instId] = price
              updateMarketPrice(instId, price)
            }
          }
        } catch (err) {
          console.error(`Failed to fetch price for ${instId}:`, err.message)
        }
      }
      
      positions = getLocalPositions()
    }
    
    // Calculate P&L for each position
    const positionsWithPnL = positions.map(pos => {
      const leverage = parseFloat(pos.leverage) || 1
      const size = parseFloat(pos.size) || 0
      const entryPrice = parseFloat(pos.entryPrice) || 0
      const currentPrice = currentPrices[pos.instId] || parseFloat(pos.currentPrice) || entryPrice
      
      if (entryPrice === 0) {
        return {
          ...pos,
          currentPrice,
          leverage,
          pnl: '0.00',
          pnlUsdt: '0.0000',
          source: 'local',
        }
      }
      
      const priceDiff = currentPrice - entryPrice
      const basePnlPercent = pos.side === 'buy'
        ? (priceDiff / entryPrice) * 100
        : (-priceDiff / entryPrice) * 100
      
      const pnlPercent = basePnlPercent * leverage
      const pnlUsdt = (basePnlPercent / 100) * size * leverage
      
      return {
        ...pos,
        currentPrice,
        leverage,
        pnl: pnlPercent.toFixed(2),
        pnlUsdt: pnlUsdt.toFixed(4),
        source: 'local',
      }
    })
    
    return NextResponse.json({
      success: true,
      positions: positionsWithPnL,
      count: positionsWithPnL.length,
      source: 'local',
      mode: isDemoMode() ? 'demo' : 'live',
    })
    
  } catch (error) {
    console.error('Positions GET error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      positions: [],
    }, { status: 500 })
  }
}

/**
 * POST /api/positions
 * 
 * Manage positions (close, clear)
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { action, positionId } = body
    
    if (action === 'close' && positionId) {
      // Get current price before closing
      let currentPrice = null
      const positions = getPositions()
      const posToClose = positions.find(p => p.id === positionId)
      
      if (posToClose) {
        try {
          const ticker = await getTicker(posToClose.instId)
          currentPrice = parseFloat(ticker.last)
        } catch (err) {
          currentPrice = posToClose.currentPrice
        }
      }
      
      const closedPosition = closePosition(positionId)
      
      if (closedPosition) {
        // Calculate P&L for the closed position
        const entryPrice = parseFloat(closedPosition.entryPrice)
        const exitPrice = currentPrice || parseFloat(closedPosition.currentPrice)
        const size = parseFloat(closedPosition.size)
        const leverage = closedPosition.leverage || 1
        
        const pnlPercent = closedPosition.side === 'buy'
          ? ((exitPrice - entryPrice) / entryPrice) * 100 * leverage
          : ((entryPrice - exitPrice) / entryPrice) * 100 * leverage
        
        const pnlUsdt = (pnlPercent / 100) * size
        
        // Log the close trade to history
        const mode = isDemoMode() ? 'demo' : (closedPosition.mode || 'live')
        recordTrade({
          mode: mode,
          instId: closedPosition.instId,
          side: closedPosition.side === 'buy' ? 'sell' : 'buy', // Opposite side for close
          price: exitPrice,
          size: size,
          leverage: leverage,
          signal: 'CLOSE',
          orderId: `close_${closedPosition.id}`,
          reason: 'Manual close',
          action: 'close',
          entryPrice: entryPrice,
          pnlPercent: pnlPercent.toFixed(2),
          pnlUsdt: pnlUsdt.toFixed(4),
        })
        
        addLog(`[${closedPosition.instId}] Position closed @ $${exitPrice.toFixed(2)} | P/L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ($${pnlUsdt.toFixed(2)})`, 'trade')
        
        return NextResponse.json({
          success: true,
          message: 'Position closed',
          closedPosition: {
            ...closedPosition,
            exitPrice,
            pnlPercent: pnlPercent.toFixed(2),
            pnlUsdt: pnlUsdt.toFixed(4),
          },
          positions: getPositions(),
        })
      } else {
        return NextResponse.json({
          success: false,
          error: 'Position not found',
        }, { status: 404 })
      }
    }
    
    if (action === 'closeAll') {
      // Close all positions and log each
      const positions = getPositions()
      const mode = isDemoMode() ? 'demo' : 'live'
      
      for (const pos of positions) {
        let exitPrice = pos.currentPrice
        try {
          const ticker = await getTicker(pos.instId)
          exitPrice = parseFloat(ticker.last)
        } catch (err) {
          // Use cached price
        }
        
        const entryPrice = parseFloat(pos.entryPrice)
        const size = parseFloat(pos.size)
        const leverage = pos.leverage || 1
        
        const pnlPercent = pos.side === 'buy'
          ? ((exitPrice - entryPrice) / entryPrice) * 100 * leverage
          : ((entryPrice - exitPrice) / entryPrice) * 100 * leverage
        
        const pnlUsdt = (pnlPercent / 100) * size
        
        recordTrade({
          mode: pos.mode || mode,
          instId: pos.instId,
          side: pos.side === 'buy' ? 'sell' : 'buy',
          price: exitPrice,
          size: size,
          leverage: leverage,
          signal: 'CLOSE',
          orderId: `close_${pos.id}`,
          reason: 'Close all',
          action: 'close',
          entryPrice: entryPrice,
          pnlPercent: pnlPercent.toFixed(2),
          pnlUsdt: pnlUsdt.toFixed(4),
        })
        
        addLog(`[${pos.instId}] Position closed @ $${exitPrice.toFixed(2)} | P/L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`, 'trade')
      }
      
      clearPositions()
      return NextResponse.json({
        success: true,
        message: `All ${positions.length} positions closed`,
        positions: [],
      })
    }
    
    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use "close" with positionId or "closeAll".',
    }, { status: 400 })
    
  } catch (error) {
    console.error('Positions POST error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 })
  }
}
