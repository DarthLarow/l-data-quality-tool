import { NextRequest, NextResponse } from 'next/server'
import { runCheckSession } from '@/lib/checks/orchestrator'
import { logger } from '@/lib/logger'
import type { CheckSessionInput } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as CheckSessionInput
    const sessionId = await runCheckSession(input)
    return NextResponse.json({ sessionId })
  } catch (error) {
    logger.error('[POST /api/checks] session failed', { error: String(error) })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
