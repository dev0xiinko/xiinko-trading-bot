/**
 * Trade Log API Route
 * 
 * Provides trade history and statistics for analysis.
 */

import { NextResponse } from 'next/server'
import { 
  getTradeHistory, 
  getTradeStats, 
  clearTradeHistory, 
  exportTrades,
  getRecentTradesSummary 
} from '@/lib/tradeLog'
import { isDemoMode } from '@/lib/okxClient'

/**
 * GET /api/trades
 * 
 * Get trade history and stats
 * 
 * Query params:
 * - mode: 'demo' | 'live' | 'all' (default: current mode)
 * - limit: number (default: 50)
 * - action: 'history' | 'stats' | 'export' | 'recent'
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') || (isDemoMode() ? 'demo' : 'live')
    const limit = parseInt(searchParams.get('limit') || '50')
    const action = searchParams.get('action') || 'history'
    
    let data = {}
    
    switch (action) {
      case 'stats':
        data = {
          stats: getTradeStats(mode === 'all' ? null : mode),
          currentMode: isDemoMode() ? 'demo' : 'live',
        }
        break
        
      case 'export':
        data = exportTrades(mode === 'all' ? null : mode)
        break
        
      case 'recent':
        data = {
          trades: getRecentTradesSummary(limit),
          currentMode: isDemoMode() ? 'demo' : 'live',
        }
        break
        
      case 'history':
      default:
        data = {
          trades: getTradeHistory({ 
            mode: mode === 'all' ? null : mode, 
            limit 
          }),
          stats: getTradeStats(mode === 'all' ? null : mode),
          currentMode: isDemoMode() ? 'demo' : 'live',
        }
        break
    }
    
    return NextResponse.json({
      success: true,
      ...data,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 })
  }
}

/**
 * DELETE /api/trades
 * 
 * Clear trade history
 * 
 * Query params:
 * - mode: 'demo' | 'live' | 'all'
 */
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') || 'demo'
    
    clearTradeHistory(mode === 'all' ? null : mode)
    
    return NextResponse.json({
      success: true,
      message: `Cleared ${mode} trade history`,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 })
  }
}
