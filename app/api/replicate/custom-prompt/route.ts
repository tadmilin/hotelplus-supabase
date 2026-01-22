import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(req: NextRequest) {
  try {
    const { jobId, prompt, imageUrls, templateUrl, outputSize } = await req.json()

    console.log('📥 Custom Prompt Request:', {
      jobId,
      hasPrompt: !!prompt,
      imageCount: imageUrls?.length || 0,
      hasTemplate: !!templateUrl,
      templateUrl: templateUrl || 'none',
      outputSize,
    })

    if (!jobId || !prompt || !imageUrls || imageUrls.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // 🔥 Practical validation: 6 images for reliability (+ 1 template = 7 total)
    if (templateUrl && imageUrls.length > 6) {
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
      finalPrompt = `ใช้รูปแรกเป็น template รักษา layout และดีไซน์ไว้
      
คำสั่ง: ${prompt}

วางรูปที่เหลือทั้งหมดในองค์ประกอบตามคำสั่งข้างต้นและลบข้อความตัวอักษรตัวเลขทั้งหมดออกจากภาพให้ด้วย`
      
      const input: Record<string, unknown> = {
        image_input: [templateUrl, ...imageUrls],
        prompt: finalPrompt,
        aspect_ratio: outputSize || 'match_input_image',
        output_format: 'png',
        resolution: '1K',
        safety_filter_level: 'block_only_high',
      }
      
      console.log(`🎨 Using resolution: 1K (${imageUrls.length + 1} images total, auto-upscale x2 enabled)`)

      const prediction = await replicate.predictions.create({
        model: model,
        input: input,
        webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
        webhook_events_filter: ['completed'],
      })

      // 🔥 Update replicate_id for webhook tracking (enables auto-upscale)
      const supabase = await createClient()
      await supabase
        .from('jobs')
        .update({ replicate_id: prediction.id })
        .eq('id', jobId)

      return NextResponse.json({
        success: true,
        id: prediction.id,
        status: prediction.status,
      })
    }
    
    // NO TEMPLATE: Create separate prediction for EACH image
    // Only use first image for this prediction (Frontend will handle creating multiple jobs)
    const input: Record<string, unknown> = {
      image_input: [imageUrls[0]],  // Use only the first image
      prompt: prompt,
      aspect_ratio: outputSize || 'match_input_image',
      output_format: 'png',
      resolution: '1K',
      safety_filter_level: 'block_only_high', // 🔥 Same as Replicate web UI default
    }

    const prediction = await replicate.predictions.create({
      model: model,
      input: input,
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
      webhook_events_filter: ['completed'],
    })

    // 🔥 Update replicate_id for webhook tracking (enables auto-upscale)
    const supabase = await createClient()
    await supabase
      .from('jobs')
      .update({ replicate_id: prediction.id })
      .eq('id', jobId)

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
