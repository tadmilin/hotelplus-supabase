import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { jobId, prompt, templateUrl, aspectRatio, numberOfImages, quality, outputFormat, background, moderation, inputFidelity, outputCompression, inputImages } = body
  
  try {

    console.log('🚀 Starting GPT → Template Pipeline:', { jobId, numberOfImages, inputImageCount: inputImages?.length || 0 })

    // ======= STEP 1: GPT Image 1.5 (สร้างรูปทีละรูป) =======
    console.log('📸 Step 1: Running GPT Image 1.5...')
    const gptOutput: string[] = []

    // ถ้ามี input images หลายรูป -> สร้างแยกรูปทีละรูป เพื่อไม่ให้เป็น collage
    if (inputImages && inputImages.length > 0) {
      console.log(`🔄 Processing ${inputImages.length} input images separately...`)
      
      for (let i = 0; i < inputImages.length; i++) {
        console.log(`  📷 Image ${i + 1}/${inputImages.length}...`)
        
        const singleInput: Record<string, unknown> = {
          prompt: prompt,
          aspect_ratio: aspectRatio || '1:1',
          number_of_images: 1, // สร้างรูปเดียวต่อ input
          quality: quality || 'auto',
          output_format: outputFormat || 'webp',
          background: background || 'auto',
          moderation: moderation || 'auto',
          input_fidelity: inputFidelity || 'low',
          output_compression: outputCompression || 90,
          input_images: [inputImages[i]], // ส่งทีละรูป
        }

        const gptPrediction = await replicate.predictions.create({
          model: 'openai/gpt-image-1.5',
          input: singleInput,
        })

        const gptResult = await replicate.wait(gptPrediction)
        const output = gptResult.output as string[]
        
        if (output && output.length > 0) {
          gptOutput.push(...output)
          console.log(`  ✅ Image ${i + 1} completed`)
        }
      }
    } else {
      // ไม่มี input images -> สร้างตาม numberOfImages ปกติ
      const gptInput: Record<string, unknown> = {
        prompt: prompt,
        aspect_ratio: aspectRatio || '1:1',
        number_of_images: numberOfImages || 1,
        quality: quality || 'auto',
        output_format: outputFormat || 'webp',
        background: background || 'auto',
        moderation: moderation || 'auto',
        input_fidelity: inputFidelity || 'low',
        output_compression: outputCompression || 90,
      }

      const gptPrediction = await replicate.predictions.create({
        model: 'openai/gpt-image-1.5',
        input: gptInput,
      })

      const gptResult = await replicate.wait(gptPrediction)
      const output = gptResult.output as string[]
      gptOutput.push(...output)
    }

    console.log('✅ GPT Image completed:', gptOutput.length, 'images')

    // Update job with GPT results
    const supabase = await createClient()
    await supabase
      .from('jobs')
      .update({ 
        output_urls: gptOutput,
        status: 'processing_template'
      })
      .eq('id', jobId)

    // ======= STEP 2: Nano Banana Pro (Apply Template - ยิงครั้งเดียว) =======
    console.log('🎨 Step 2: Applying template with Nano Banana Pro...')
    console.log(`📋 Template: ${templateUrl}`)
    console.log(`📸 Input images: ${gptOutput.length} images`)
    
    // Hardcoded prompt for template application
    const templatePrompt = "รักษา Layout และกรอบดีไซน์จากภาพแรกไว้ทั้งหมด (กราฟิค, กรอบ) ขั้นตอน: 1. ใช้ภาพแรก (รูปแรกหลัง Template) เป็นภาพหลัก/Background/Hero Image ใหญ่สุด 2. ถ้ามีรูปเพิ่ม: ใช้เป็นรูปเล็กหรือรูปประกอบในตำแหน่งรองที่เหมาะสม 3. วางภาพใหม่ทั้งหมดในเลเยอร์ด้านหลัง (ไม่ทับกรอบ) สิ่งที่ห้ามแก้ไข: กรอบ,ตำแหน่ง Layout สิ่งที่สามารถแก้ได้: ภาพพื้นหลังและรูปเล็กทั้งหมด (ต้องเป็นภาพใหม่ที่แนบมา) สิ่งที่ต้องลบออก: ข้อความ(ตัวอักษรและตัวเลขทั้งหมด)และโลโก้"

    const nanoInput = {
      prompt: templatePrompt,
      template_image: templateUrl, // รูปเทมเพลตที่แนบมา (กรอบ/layout)
      input_images: gptOutput, // รูปทั้งหมดจาก GPT Image ที่จะใส่ในเทมเพลต
      num_inference_steps: 50,
      guidance_scale: 7.5,
      num_outputs: 1, // ✅ Output 1 รูปเดียว (เทมเพลต + รูปทั้งหมดข้างใน)
    }

    let templateResults: string[] = []

    try {
      console.log('🚀 Calling Nano Banana Pro (single API call)...')
      
      const nanoPrediction = await replicate.predictions.create({
        model: 'google/nano-banana-pro',
        input: nanoInput,
      })

      const nanoResult = await replicate.wait(nanoPrediction)
      templateResults = nanoResult.output as string[]

      console.log(`✅ Template applied successfully: ${templateResults.length} images`)
    } catch (err) {
      console.error('❌ Nano Banana Pro failed:', err)
      console.log('⚠️ Fallback: Using GPT Image results without template')
      templateResults = gptOutput // ใช้รูปจาก GPT แทน
    }

    console.log('✅ Pipeline completed:', templateResults.length, 'images')

    // Update job with template results
    await supabase
      .from('jobs')
      .update({ 
        output_urls: templateResults,
        status: 'completed'
      })
      .eq('id', jobId)

    // ======= STEP 3: Auto Upscale (Optional - Future) =======
    // TODO: Add auto upscale if enabled

    return NextResponse.json({ 
      success: true,
      id: jobId,
      gptResults: gptOutput.length,
      templateResults: templateResults.length,
      output: templateResults
    })

  } catch (error: unknown) {
    console.error('Pipeline error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
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
      } catch (e) {
        console.error('Failed to update job status:', e)
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
