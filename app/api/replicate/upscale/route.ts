import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(req: NextRequest) {
  try {
    const { jobId, imageUrl, scale, faceEnhance } = await req.json()

    if (!jobId || !imageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use Real-ESRGAN for upscaling
    const prediction = await replicate.predictions.create({
      model: 'nightmareai/real-esrgan',
      input: {
        image: imageUrl,
        scale: scale || 2,
        face_enhance: faceEnhance || false, // GFPGAN face enhancement
      },
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
      webhook_events_filter: ['completed'],
    })

    return NextResponse.json({
      success: true,
      id: prediction.id,
      status: prediction.status,
    })
  } catch (error: unknown) {
    console.error('Replicate API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upscale' },
      { status: 500 }
    )
  }
}
