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

    // � Merge mode validation: max 10 images without template
    if (!templateUrl && validImageUrls.length > 10) {
      return NextResponse.json(
        { error: 'Max 10 images for merge mode. More images increase failure rate.' },
        { status: 400 }
      )
    }

    // �🛡️ GUARD: Check if job already has a prediction (prevent duplicates on retry)
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

    // Always use Nano Banana Pro for custom prompt
    // Model ID: google/nano-banana-pro
    const model = 'google/nano-banana-pro'

    let finalPrompt = prompt

    // If template is provided, use template + all images together
    if (templateUrl) {
      // 🔥 Thai prompt - ชัดเจน แยก user instruction
      finalPrompt = `- ใช้รูปแรกเป็น Template อ้างอิง รักษาโครงเลย์เอาต์ สัดส่วน กริด มาร์จิน ระยะห่าง โทนสี สไตล์กราฟิก เอฟเฟกต์เงา/ไลต์/กราเดียนต์ และองค์ประกอบตกแต่งทั้งหมดให้คงเดิม 100%
- ปรับแก้รูปภาพที่เหลือตามคำสั่งต่อไปนี้: ${prompt}
- จัดวางรูปภาพทั้งหมดตามลำดับเดิม โดย:
  - รูปที่แก้ไขเป็นรูปถัดจาก Template ให้ใช้เป็นรูป Hero (ขนาดใหญ่ที่สุดใน Template)
  - รูปอื่นๆ วางต่อเนื่องตามลำดับให้ตรงกับตำแหน่ง/สัดส่วนเดิมของ Template
- ลบข้อความ ตัวอักษร ตัวเลข ไอคอนโลโก้ ลายน้ำ และเครื่องหมายการค้าทั้งหมดออกจากทุกภาพอย่างสะอาด เนียนตา โดยคงพื้นผิว/พื้นหลังเดิมให้สมจริง
- หากมีข้อความใน Template เดิม ให้ลบออกทั้งหมด
- คงความคมชัด สีสัน และโทนแสงให้ใกล้เคียงรูปต้นฉบับของ Template และทำการแมตช์โทนสีของรูปที่เหลือให้สอดคล้องกัน
- ปรับสัดส่วนภาพอัตโนมัติให้พอดีกับช่องใน Template โดยไม่บิดเบี้ยว (ใช้ fill/crop แบบคงสัดส่วน, จัดวาง subject ให้เด่นและไม่ถูกครอปส่วนสำคัญ)
- หากองค์ประกอบบางภาพไม่พอดีกับช่อง ให้จัดคอมโพสใหม่เล็กน้อยภายในกรอบเดิมโดยไม่เปลี่ยนเลย์เอาต์รวม
- หลีกเลี่ยงการเพิ่มข้อความใหม่หรือโลโก้ใดๆ ในทุกขั้นตอน`

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

    // NO TEMPLATE: Use all images sent from frontend
    // Frontend controls: merge mode = all images, each mode = 1 image per job
    const input: Record<string, unknown> = {
      image_input: validImageUrls,  // 🔥 ใช้ทุกรูปที่ส่งมา (frontend ควบคุม)
      prompt: prompt,
      aspect_ratio: outputSize || 'match_input_image',
      output_format: 'png',
      resolution: '1K',
      safety_filter_level: 'block_only_high', // 🔥 Same as Replicate web UI default
    }

    console.log(`📸 Processing ${validImageUrls.length} image(s) without template`)

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
