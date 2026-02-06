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
    const { 
      prompt, 
      aspectRatio, 
      numberOfImages, 
      quality, 
      outputFormat,
      background,
      moderation,
      inputFidelity,
      outputCompression,
      inputImages,
      targetAspectRatio, // User's desired ratio (may differ from GPT ratio)
    } = body

    console.log('📥 GPT Image Request:', {
      jobId,
      hasPrompt: !!prompt,
      aspectRatio,
      numberOfImages,
      quality,
      outputFormat,
      background,
      moderation,
      inputFidelity,
      outputCompression,
      inputImageCount: inputImages?.length || 0,
    })

    if (!jobId || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate input images count (recommended max for stability)
    if (inputImages && inputImages.length > 10) {
      return NextResponse.json(
        { error: 'Max 10 input images for stability' },
        { status: 400 }
      )
    }

    // 🛡️ GUARD: Check if job already has a prediction (prevent duplicates on retry)
    const supabaseCheck = await createClient()
    const { data: existingJob } = await supabaseCheck
      .from('jobs')
      .select('replicate_id')
      .eq('id', jobId)
      .single()

    if (existingJob?.replicate_id) {
      console.log('⚠️ Job already has prediction, skipping duplicate:', existingJob.replicate_id)
      return NextResponse.json({
        success: true,
        id: existingJob.replicate_id,
        message: 'Job already has prediction - skipped duplicate'
      })
    }

    // Create prediction with openai/gpt-image-1.5
    const model = 'openai/gpt-image-1.5'
    
    // Validate parameters (only specific values are valid)
    const validBackgrounds = ['auto', 'transparent', 'opaque']
    const validatedBackground = background && validBackgrounds.includes(background) ? background : 'auto'
    
    const validModerations = ['auto', 'low']
    const validatedModeration = moderation && validModerations.includes(moderation) ? moderation : 'auto'
    
    const validFidelities = ['low', 'high']
    const validatedFidelity = inputFidelity && validFidelities.includes(inputFidelity) ? inputFidelity : 'low'
    
    const input: Record<string, unknown> = {
      prompt: prompt,
      aspect_ratio: aspectRatio || '1:1',
      number_of_images: numberOfImages || 1,
      quality: quality || 'auto',
      output_format: outputFormat || 'webp',
      background: validatedBackground,
      moderation: validatedModeration,
      input_fidelity: validatedFidelity,
      output_compression: outputCompression || 90,
    }

    // Add input images if provided (must be array of URLs)
    if (inputImages && Array.isArray(inputImages) && inputImages.length > 0) {
      // Filter out any null, undefined, or empty strings
      const validImages = inputImages.filter(url => url && typeof url === 'string' && url.trim() !== '')
      if (validImages.length > 0) {
        input.input_images = validImages
        console.log('📸 Input images:', validImages.length)
      }
    }

    console.log('🚀 Sending to Replicate:', {
      model,
      hasInputImages: !!input.input_images,
      inputKeys: Object.keys(input)
    })

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

    // Update job with prediction ID, status, and targetAspectRatio in metadata
    const supabase = await createClient()
    const updateData: Record<string, unknown> = { 
      replicate_id: prediction.id,
      status: 'processing'
    }
    
    // 🔥 Store targetAspectRatio in metadata for webhook to crop later
    if (targetAspectRatio) {
      // Fetch existing metadata to merge (prevent overwrite)
      const { data: existingJob } = await supabase
        .from('jobs')
        .select('metadata')
        .eq('id', jobId)
        .single()
      
      const existingMetadata = (existingJob?.metadata as Record<string, unknown>) || {}
      updateData.metadata = { ...existingMetadata, targetAspectRatio }
      console.log('📐 Will crop to:', targetAspectRatio)
    }
    
    const { error: updateError } = await supabase
      .from('jobs')
      .update(updateData)
      .eq('id', jobId)

    if (updateError) {
      console.error('❌ Failed to update job:', updateError)
      throw new Error('Failed to update job with prediction ID')
    }

    console.log('✅ Job updated successfully')

    return NextResponse.json({
      success: true,
      id: prediction.id,
      status: prediction.status,
    })
  } catch (error: unknown) {
    console.error('❌ GPT Image API error:', error)
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
