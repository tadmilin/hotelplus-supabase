import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(req: NextRequest) {
  try {
    const { 
      jobId, 
      prompt, 
      aspectRatio, 
      numberOfImages, 
      quality, 
      outputFormat,
      inputImages 
    } = await req.json()

    console.log('📥 GPT Image Request:', {
      jobId,
      hasPrompt: !!prompt,
      aspectRatio,
      numberOfImages,
      quality,
      outputFormat,
      inputImageCount: inputImages?.length || 0,
    })

    if (!jobId || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create prediction with openai/gpt-image-1.5
    const model = 'openai/gpt-image-1.5'
    
    const input: Record<string, unknown> = {
      prompt: prompt,
      aspect_ratio: aspectRatio || '1:1',
      number_of_images: numberOfImages || 1,
      quality: quality || 'auto',
      output_format: outputFormat || 'webp',
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

    const prediction = await replicate.predictions.create({
      model: model,
      input: input,
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
      webhook_events_filter: ['completed'],
    })

    console.log('✅ GPT Image prediction created:', prediction.id)

    // If number_of_images > 1, the output will be an array
    // We'll handle it in the webhook

    return NextResponse.json({
      success: true,
      id: prediction.id,
      status: prediction.status,
    })
  } catch (error: unknown) {
    console.error('Replicate API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create prediction'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
