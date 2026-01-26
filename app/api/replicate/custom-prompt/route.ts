import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(req: NextRequest) {
  let jobId: string | null = null

  try {
    const body = await req.json()
    jobId = body.jobId
    const { prompt, imageUrls, templateUrl, outputSize } = body

    console.log('📥 Custom Prompt Request:', {
      jobId,
      hasPrompt: !!prompt,
      imageCount: imageUrls?.length || 0,
      hasTemplate: !!templateUrl,
      templateUrl: templateUrl || 'none',
      outputSize,
    })

    if (!jobId || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: jobId and prompt' },
        { status: 400 }
      )
    }

    // Validate imageUrls is array and filter invalid URLs
    if (!imageUrls || !Array.isArray(imageUrls)) {
      return NextResponse.json(
        { error: 'imageUrls must be an array' },
        { status: 400 }
      )
    }

    const validImageUrls = imageUrls.filter(url => url && typeof url === 'string' && url.trim() !== '')

    if (validImageUrls.length === 0) {
      return NextResponse.json(
        { error: 'No valid image URLs provided' },
        { status: 400 }
      )
    }

    // 🔥 Practical validation: 6 images for reliability (+ 1 template = 7 total)
    if (templateUrl && validImageUrls.length > 6) {
      return NextResponse.json(
        { error: 'For reliability, max 6 images (+ 1 template = 7 total). More images increase failure rate.' },
        { status: 400 }
      )
    }

    // Always use Nano Banana Pro for custom prompt
    // Model ID: google/nano-banana-pro
    const model = 'google/nano-banana-pro'

    let finalPrompt = prompt

    // If template is provided, use template + all images together
    if (templateUrl) {
      // 🔥 Thai prompt - ชัดเจน แยก user instruction
      finalPrompt = `ใช้รูปแรกเป็น template รักษา layoutและดีไซน์ไว้คงเดิมทั้งหมด แก้ไขรูปภาพที่เหลือตามคำสั่ง: ${prompt} จากนั้นวางรูปที่เหลือทั้งหมดตามลำดับโดยให้รูปที่แก้ไขรูปแรก(รูปถัดจากtemplate)เป็นรูปheroหรือรูปใหญ่ที่สุดในtemplateและลบข้อความตัวอักษรตัวเลขโลโก้ทั้งหมดออกจากภาพให้ด้วย`

      const input: Record<string, unknown> = {
        image_input: [templateUrl, ...validImageUrls],
        prompt: finalPrompt,
        aspect_ratio: outputSize || 'match_input_image',
        output_format: 'png',
        resolution: '1K',
        safety_filter_level: 'block_only_high',
      }

      console.log(`🎨 Using resolution: 1K (${validImageUrls.length + 1} images total, auto-upscale x2 enabled)`)

      // Retry logic for Replicate API (max 3 attempts)
      let prediction
      const maxRetries = 3

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          prediction = await replicate.predictions.create({
            model: model,
            input: input,
            webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
            webhook_events_filter: ['completed'],
          })
          console.log(`✅ Prediction created on attempt ${attempt}`)
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

      // 🔥 Update replicate_id for webhook tracking (enables auto-upscale)
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
    }

    // NO TEMPLATE: Create separate prediction for EACH image
    // Only use first image for this prediction (Frontend will handle creating multiple jobs)
    const input: Record<string, unknown> = {
      image_input: [validImageUrls[0]],  // Use only the first image
      prompt: prompt,
      aspect_ratio: outputSize || 'match_input_image',
      output_format: 'png',
      resolution: '1K',
      safety_filter_level: 'block_only_high', // 🔥 Same as Replicate web UI default
    }

    // Retry logic (max 3 attempts)
    let prediction
    const maxRetries = 3

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        prediction = await replicate.predictions.create({
          model: model,
          input: input,
          webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
          webhook_events_filter: ['completed'],
        })
        console.log(`✅ Prediction created on attempt ${attempt}`)
        break
      } catch (apiError: unknown) {
        const error = apiError as { response?: { status?: number }; message?: string }
        const isLastAttempt = attempt === maxRetries

        if (isLastAttempt) {
          console.error(`❌ Failed after ${maxRetries} attempts:`, error.message)
          throw apiError
        }

        const isRateLimit = error?.response?.status === 429
        const backoffMs = isRateLimit ? 2000 * attempt : 1000 * attempt

        console.log(`⚠️ Attempt ${attempt} failed (${isRateLimit ? 'rate limit' : 'error'}), retrying in ${backoffMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }
    }

    if (!prediction) {
      throw new Error('Prediction is undefined after retries')
    }

    // 🔥 Update replicate_id for webhook tracking (enables auto-upscale)
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
    console.error('❌ Custom Prompt API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create prediction'

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
