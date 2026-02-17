/**
 * Settings API Route
 * 
 * Manages bot settings including demo mode toggle and trade configuration.
 */

import { NextResponse } from 'next/server'
import { setDemoMode, isDemoMode } from '@/lib/okxClient'
import { addLog, getTradeConfig, setTradeConfig } from '@/lib/state'

/**
 * GET /api/settings
 * 
 * Returns current settings
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    settings: {
      demoMode: isDemoMode(),
      tradeConfig: getTradeConfig(),
    },
  })
}

/**
 * POST /api/settings
 * 
 * Update settings
 */
export async function POST(request) {
  try {
    const body = await request.json()
    
    // Update demo mode
    if (typeof body.demoMode === 'boolean') {
      setDemoMode(body.demoMode)
      addLog(`Demo mode ${body.demoMode ? 'enabled' : 'disabled'}`, 'info')
    }
    
    // Update margin (supports both 'margin' and legacy 'tradeSize')
    const marginValue = body.margin ?? body.tradeSize
    if (typeof marginValue === 'number') {
      setTradeConfig({ margin: marginValue })
    }
    
    // Update leverage
    if (typeof body.leverage === 'number') {
      setTradeConfig({ leverage: body.leverage })
    }
    
    return NextResponse.json({
      success: true,
      settings: {
        demoMode: isDemoMode(),
        tradeConfig: getTradeConfig(),
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 })
  }
}
