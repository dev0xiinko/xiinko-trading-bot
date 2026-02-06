/**
 * Account API Route
 * 
 * Fetches account balance from OKX
 * 
 * ⚠️ WARNING: Requires valid API credentials
 */

import { NextResponse } from 'next/server'
import { getBalance, isConfigured } from '@/lib/okxClient'
import { addLog } from '@/lib/state'

/**
 * GET /api/account
 * 
 * Returns account balance information
 */
export async function GET() {
  try {
    // Check if API is configured
    if (!isConfigured()) {
      return NextResponse.json({
        success: false,
        error: 'API credentials not configured',
        balance: {
          total: '0.00',
          available: '0.00',
          currencies: [],
        },
      })
    }

    // Fetch balance from OKX
    const balanceData = await getBalance()
    
    // Parse the balance data
    // OKX returns: { details: [{ ccy, availBal, frozenBal, ... }], totalEq, ... }
    const currencies = balanceData.details?.map(d => ({
      currency: d.ccy,
      available: parseFloat(d.availBal || 0),
      frozen: parseFloat(d.frozenBal || 0),
      total: parseFloat(d.availBal || 0) + parseFloat(d.frozenBal || 0),
    })) || []

    // Calculate totals (OKX provides totalEq in USD)
    const totalEquity = parseFloat(balanceData.totalEq || 0)
    const availableBalance = currencies.reduce((sum, c) => sum + c.available, 0)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      balance: {
        total: totalEquity.toFixed(2),
        available: availableBalance.toFixed(2),
        currencies: currencies.filter(c => c.total > 0), // Only show non-zero balances
      },
    })
  } catch (error) {
    console.error('Account API error:', error)
    addLog(`Balance fetch error: ${error.message}`, 'error')
    
    return NextResponse.json({
      success: false,
      error: error.message,
      balance: {
        total: '0.00',
        available: '0.00',
        currencies: [],
      },
    }, { status: 500 })
  }
}
