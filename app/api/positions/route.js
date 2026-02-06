/**
 * Positions API Route
 * 
 * Endpoints:
 * - GET: Get all active positions with current prices
 * - POST: Close a position or update prices
 */

import { NextResponse } from 'next/server'
import { getPositions, closePosition, updateMarketPrice, clearPositions, addLog } from '@/lib/state'
import { getTicker, isDemoMode } from '@/lib/okxClient'
import { recordTrade } from '@/lib/tradeLog'

/**
 * GET /api/positions
 * 
 * Fetch all active positions with updated prices
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const updatePrices = searchParams.get('updatePrices') === 'true'
    
    let positions = getPositions()
    
    // Store fetched prices for accurate calculation
    const currentPrices = {}
    
    // Optionally fetch current prices for all positions
    if (updatePrices && positions.length > 0) {
      // Get unique instrument IDs
      const instIds = [...new Set(positions.map(p => p.instId))]
      
      // Fetch current prices for each instrument
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
      
      // Get updated positions
      positions = getPositions()
    }
    
    // Calculate P&L for each position (including leverage)
    const positionsWithPnL = positions.map(pos => {
      const leverage = parseFloat(pos.leverage) || 1
      const size = parseFloat(pos.size) || 0
      const entryPrice = parseFloat(pos.entryPrice) || 0
      
      // Use freshly fetched price if available, otherwise use stored currentPrice
      const currentPrice = currentPrices[pos.instId] || parseFloat(pos.currentPrice) || entryPrice
      
      // Avoid division by zero
      if (entryPrice === 0) {
        return {
          ...pos,
          currentPrice: currentPrice,
          leverage: leverage,
          pnl: '0.00',
          pnlUsdt: '0.0000',
          basePnl: '0.00',
        }
      }
      
      // Price difference
      const priceDiff = currentPrice - entryPrice
      
      // Base P&L percentage (without leverage)
      const basePnlPercent = pos.side === 'buy'
        ? (priceDiff / entryPrice) * 100
        : (-priceDiff / entryPrice) * 100
      
      // P&L percentage with leverage
      const pnlPercent = basePnlPercent * leverage
      
      // P&L in USDT
      // Formula: (price change %) * position size * leverage
      const pnlUsdt = (basePnlPercent / 100) * size * leverage
      
      return {
        ...pos,
        currentPrice: currentPrice,
        leverage: leverage,
        pnl: pnlPercent.toFixed(2),
        pnlUsdt: pnlUsdt.toFixed(4),
        basePnl: basePnlPercent.toFixed(2),
      }
    })
    
    return NextResponse.json({
      success: true,
      positions: positionsWithPnL,
      count: positionsWithPnL.length,
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
