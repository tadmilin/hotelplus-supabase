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

    // Always use Nano Banana Pro for custom prompt
    // Model ID: google/nano-banana-pro
    const model = 'google/nano-banana-pro'
    
    // 🔥 ตรวจสอบว่ามีคำว่า "คน" ใน prompt หรือไม่
    const hasPerson = /คน|ผู้คน|บุคคล|ผู้หญิง|ผู้ชาย|เด็ก|คนไทย|นักท่องเที่ยว|พนักงาน|แขก|person|people|human|man|woman|child|guest|staff|tourist/i.test(prompt)
    const faceEnhancement = hasPerson ? ', high resolution face, clear facial features, photorealistic portrait, sharp face details' : ''
    
    let finalPrompt = prompt
    
    // If template is provided, use template + all images together
    if (templateUrl) {
      // 🔥 รวม USER PROMPT + TEMPLATE INSTRUCTION + FACE ENHANCEMENT
      finalPrompt = `[USER REQUEST: ${prompt}${faceEnhancement}]

[TEMPLATE MODE] รักษา Layout และกรอบดีไซน์จากภาพแรกไว้ทั้งหมด (กราฟิค, กรอบ)

ขั้นตอน:
1. ใช้ภาพแรก (รูปแรกหลัง Template) เป็นภาพหลัก/Background/Hero Image ใหญ่สุด
2. ถ้ามีรูปเพิ่ม: ใช้เป็นรูปเล็กหรือรูปประกอบในตำแหน่งรองที่เหมาะสม
3. วางภาพใหม่ทั้งหมดในเลเยอร์ด้านหลัง (ไม่ทับกรอบ)
4. ปรับแต่งตามคำขอของผู้ใช้: ${prompt}${faceEnhancement}

สิ่งที่ห้ามแก้ไข: กรอบ, ตำแหน่ง Layout
สิ่งที่สามารถแก้ได้: ภาพพื้นหลังและรูปเล็กทั้งหมด (ต้องเป็นภาพใหม่ที่แนบมา), สี, แสง, ความสว่าง, ตามที่ผู้ใช้ระบุ
สิ่งที่ต้องลบออก: ข้อความตัวอักษรและตัวเลขทั้งหมดและโลโก้`
      
      const input: Record<string, unknown> = {
        image_input: [templateUrl, ...imageUrls],
        prompt: finalPrompt,
        aspect_ratio: outputSize || 'match_input_image',
        output_format: 'png',
        resolution: '1K', // ✅ ลดเป็น 1K เพื่อไม่ให้เกิน GPU limit ตอน auto-upscale (2K = 2048x2048 ใหญ่เกินไป)
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
    }
    
    // NO TEMPLATE: Create separate prediction for EACH image
    // Only use first image for this prediction (Frontend will handle creating multiple jobs)
    const input: Record<string, unknown> = {
      image_input: [imageUrls[0]],  // Use only the first image
      prompt: prompt + faceEnhancement, // 🔥 เพิ่ม face enhancement ถ้ามีคำว่า "คน"
      aspect_ratio: outputSize || 'match_input_image',
      output_format: 'png',
      resolution: '1K', // ✅ ลดเป็น 1K เพื่อไม่ให้เกิน GPU limit ตอน auto-upscale
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
