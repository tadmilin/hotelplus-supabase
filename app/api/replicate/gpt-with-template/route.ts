import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(request: NextRequest) {
  try {
    const { jobId, prompt, templateUrl, aspectRatio, numberOfImages, quality, outputFormat, background, moderation, inputFidelity, outputCompression, inputImages } = await request.json()

    console.log('🚀 Starting GPT → Template Pipeline:', { jobId, numberOfImages })

    // ======= STEP 1: GPT Image 1.5 =======
    console.log('📸 Step 1: Running GPT Image 1.5...')
    const gptInput: Record<string, unknown> = {
      prompt: prompt,
      aspect_ratio: aspectRatio,
      num_outputs: numberOfImages,
      quality: quality,
      output_format: outputFormat,
      background: background,
      moderation: moderation,
      input_fidelity: inputFidelity,
      output_compression: outputCompression,
    }

    if (inputImages && inputImages.length > 0) {
      gptInput.input_images = inputImages
    }

    const gptOutput = await replicate.run(
      "openai/gpt-image-1.5:latest",
      { input: gptInput }
    ) as string[]

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

    // ======= STEP 2: Nano Banana Pro (Apply Template to All) =======
    console.log('🎨 Step 2: Applying template with Nano Banana Pro...')
    
    // Hardcoded prompt for template application
    const templatePrompt = "รักษา Layout และกรอบดีไซน์จากภาพแรกไว้ทั้งหมด (กราฟิค, กรอบ) ขั้นตอน: 1. ใช้ภาพแรก (รูปแรกหลัง Template)  เป็นภาพหลัก/Background/Hero Image ใหญ่สุด 2. ถ้ามีรูปเพิ่ม: ใช้เป็นรูปเล็กหรือรูปประกอบในตำแหน่งรองที่เหมาะสม 3. วางภาพใหม่ทั้งหมดในเลเยอร์ด้านหลัง (ไม่ทับกรอบ)  สิ่งที่ห้ามแก้ไข: กรอบ,ตำแหน่ง Layout สิ่งที่สามารถแก้ได้: ภาพพื้นหลังและรูปเล็กทั้งหมด (ต้องเป็นภาพใหม่ที่แนบมา) สิ่งที่ต้องลบออก: ข้อความ(ตัวอักษรและตัวเลขทั้งหมด)และโลโก้"

    const templateResults: string[] = []
    
    for (let i = 0; i < gptOutput.length; i++) {
      console.log(`🔄 Processing image ${i + 1}/${gptOutput.length}...`)
      
      const nanoInput = {
        prompt: templatePrompt,
        image: gptOutput[i], // รูปจาก GPT Image
        template_image: templateUrl, // Template reference
        num_inference_steps: 50,
        guidance_scale: 7.5,
        num_outputs: 1,
      }

      try {
        const nanoOutput = await replicate.run(
          "google/nano-banana-pro:latest",
          { input: nanoInput }
        ) as string[]

        if (nanoOutput && nanoOutput.length > 0) {
          templateResults.push(nanoOutput[0])
          console.log(`✅ Template applied ${i + 1}/${gptOutput.length}`)
        }
      } catch (err) {
        console.error(`❌ Template failed for image ${i + 1}:`, err)
        // ถ้าล้มเหลว ใช้รูปจาก GPT แทน
        templateResults.push(gptOutput[i])
      }
    }

    console.log('✅ All templates applied:', templateResults.length, 'images')

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
    if (request.json) {
      try {
        const body = await request.json()
        const supabase = await createClient()
        await supabase
          .from('jobs')
          .update({ 
            status: 'failed',
            error: errorMessage
          })
          .eq('id', body.jobId)
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
