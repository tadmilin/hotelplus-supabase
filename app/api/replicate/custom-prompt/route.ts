import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'

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

    // Always use Nano Banana Pro for custom prompt
    // Model ID: google/nano-banana-pro
    const model = 'google/nano-banana-pro'
    
    let finalPrompt = prompt
    
    // If template is provided, use template + all images together
    if (templateUrl) {
      finalPrompt = `[TEMPLATE MODE]
รักษา Layout และกรอบดีไซน์จากภาพแรกไว้ทั้งหมด (รวมข้อความ, กราฟิค, กรอบ)

ขั้นตอน:
1. ใช้ภาพที่สอง (รูปแรกหลัง Template) เป็นภาพหลัก/Background/Hero Image ใหญ่สุด
2. ถ้ามีรูปเพิ่ม: ใช้เป็นรูปเล็กหรือรูปประกอบในตำแหน่งรองที่เหมาะสม
3. วางภาพใหม่ทั้งหมดในเลเยอร์ด้านหลัง (ไม่ทับข้อความ/กรอบ)
4. ปรับแต่งภาพตามคำสั่งนี้: ${prompt}

สิ่งที่ห้ามแก้ไข: กรอบ, ข้อความ, โลโก้, ตำแหน่ง Layout
สิ่งที่สามารถแก้ได้: ภาพพื้นหลังและรูปเล็กทั้งหมด (ต้องเป็นภาพใหม่ที่แนบมา)`
      
      const input: any = {
        image_input: [templateUrl, ...imageUrls],
        prompt: finalPrompt,
        aspect_ratio: outputSize || 'match_input_image',
        output_format: 'png',
        resolution: '1K',
      }

      const prediction = await replicate.predictions.create({
        model: model,
        input: input,
        webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
        webhook_events_filter: ['completed'],
      })

      return NextResponse.json({
        success: true,
        id: prediction.id,
        status: prediction.status,
      })
    }
    
    // NO TEMPLATE: Create separate prediction for EACH image
    // Only use first image for this prediction (Frontend will handle creating multiple jobs)
    const input: any = {
      image_input: [imageUrls[0]],  // Use only the first image
      prompt: prompt,
      aspect_ratio: outputSize || 'match_input_image',
      output_format: 'png',
      resolution: '1K',
    }

    const prediction = await replicate.predictions.create({
      model: model,
      input: input,
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
