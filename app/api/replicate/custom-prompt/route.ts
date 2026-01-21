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
    
    let finalPrompt = prompt
    
    // If template is provided, use template + all images together
    if (templateUrl) {
      // Template mode: template instructions + user prompt
      finalPrompt = `[TEMPLATE MODE]ใช้ inputภาพแรกเป็นตัวอย่าง template รักษา Layout และกรอบดีไซน์จากภาพแรกไว้ให้เหมือน100% (กราฟิค, กรอบ)

ขั้นตอน:
1. ปรับแต่งภาพinput หลังรูปแรก(ตัวอย่างtemplate)ทั้งหมดตามคำขอ: ${prompt}
2. ใช้รูปแรกหลัง Template เป็นภาพหลัก/Background/Hero Image ใหญ่สุด
3. รูปลำดับถัดมา ใช้เป็นรูปเล็กหรือรูปประกอบในตำแหน่งรองที่เหมาะสม
4. วางภาพใหม่ทั้งหมดในเลเยอร์ด้านหลัง 
5. ลบข้อความตัวอักษรและตัวเลขทั้งหมดและโลโก้ออกโดยรักษาดีไซน์, โทนสี, และองค์ประกอบศิลป์อื่นๆ จากภาพตัวอย่างtemplateให้เหมือนเดิม
6. ผลลัพธ์สุดท้ายควรเป็นภาพที่ปรับแต่งตามคำขอของผู้ใช้แต่ยังคงดีไซน์และโครงสร้างจากtemplate`
      
      const input: Record<string, unknown> = {
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
