import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(req: NextRequest) {
  let jobId: string | null = null
  
  try {
    const { jobId: reqJobId, imageUrl, scale, faceEnhance } = await req.json()
    jobId = reqJobId

    if (!jobId || !imageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: jobId and imageUrl' },
        { status: 400 }
      )
    }

    // Validate imageUrl format
    if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid imageUrl format' },
        { status: 400 }
      )
    }

    console.log('🔍 Upscale Request:', { jobId, hasImageUrl: !!imageUrl, scale: scale || 2 })

    // Use Real-ESRGAN for upscaling
    const input = {
      image: imageUrl,
      scale: scale || 2,
      face_enhance: faceEnhance || false, // GFPGAN face enhancement
    }

    // Retry logic for Replicate API (max 3 attempts)
    let prediction
    const maxRetries = 3

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        prediction = await replicate.predictions.create({
          model: 'nightmareai/real-esrgan',
          input: input,
          webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
          webhook_events_filter: ['completed'],
        })
        console.log(`✅ Prediction created on attempt ${attempt}:`, prediction.id)
        break // Success
      } catch (apiError: unknown) {
        const error = apiError as { response?: { status?: number }; message?: string }
        const isLastAttempt = attempt === maxRetries
        
        if (isLastAttempt) {
          console.error(`❌ Failed after ${maxRetries} attempts:`, error.message)
          throw apiError
        }
        
        // Calculate backoff delay
        const isRateLimit = error?.response?.status === 429
        const backoffMs = isRateLimit ? 2000 * attempt : 1000 * attempt
        
        console.log(`⚠️ Attempt ${attempt} failed (${isRateLimit ? 'rate limit' : 'error'}), retrying in ${backoffMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }
    }

    if (!prediction) {
      throw new Error('Prediction is undefined after retries')
    }

    // Update job with replicate_id
    const supabase = await createClient()
    const { error: updateError } = await supabase
      .from('jobs')
      .update({ replicate_id: prediction.id, status: 'processing' })
      .eq('id', jobId)

    if (updateError) {
      console.error('❌ Failed to update job:', updateError)
      throw new Error('Failed to update job with prediction ID')
    }

    return NextResponse.json({
      success: true,
      id: prediction.id,
      status: prediction.status,
    })
  } catch (error: unknown) {
    console.error('❌ Upscale API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to upscale'
    
    // Update job status to failed
    if (jobId) {
      try {
        const supabase = await createClient()
        await supabase
          .from('jobs')
          .update({ 
            status: 'failed',
            error: errorMessage 
          })
          .eq('id', jobId)
      } catch (updateError) {
        console.error('Failed to update job status:', updateError)
      }
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
