import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(req: NextRequest) {
  try {
    const { jobId, prompt, outputSize, numImages } = await req.json()

    if (!jobId || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use Imagen 4 Ultra (Google) for text-to-image
    const prediction = await replicate.predictions.create({
      model: 'google/imagen-4-ultra',
      input: {
        prompt: prompt,
        aspect_ratio: outputSize || '1:1',
        num_outputs: numImages || 1,
      },
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
      webhook_events_filter: ['completed'],
    })

    return NextResponse.json({
      success: true,
      id: prediction.id,
      status: prediction.status,
    })
  } catch (error: any) {
    console.error('Replicate API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create prediction' },
      { status: 500 }
    )
  }
}
