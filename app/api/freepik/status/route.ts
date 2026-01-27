import { NextRequest, NextResponse } from 'next/server'
import { getMysticStatus } from '@/lib/freepik'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const taskId = searchParams.get('taskId')

    if (!taskId) {
      return NextResponse.json(
        { error: 'Missing taskId parameter' },
        { status: 400 }
      )
    }

    const result = await getMysticStatus(taskId)

    return NextResponse.json({
      taskId: result.data.task_id,
      status: result.data.status,
      generated: result.data.generated || [],
      hasNsfw: result.data.has_nsfw || [],
    })

  } catch (error) {
    console.error('❌ Freepik status error:', error)
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    )
  }
}
