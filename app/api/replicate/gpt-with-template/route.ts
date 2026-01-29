import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@supabase/supabase-js'

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN!,
})

// ใช้ service role เพื่อ bypass RLS
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
    const body = await request.json()
    const { 
        jobId, 
        prompt, 
        templateUrl, 
        aspectRatio, 
        inputImages,
        quality,
        outputFormat,
        background,
        moderation,
        inputFidelity,
        outputCompression,
        targetAspectRatio, // User's desired ratio (may differ from GPT ratio)
    } = body

    // Validate required parameters
    if (!jobId || !prompt) {
        return NextResponse.json(
            { error: 'Missing required parameters: jobId and prompt' },
            { status: 400 }
        )
    }

    if (!templateUrl) {
        return NextResponse.json(
            { error: 'Template URL is required for template mode' },
            { status: 400 }
        )
    }

    // Validate and filter input images
    let validInputImages: string[] = []
    if (inputImages) {
        if (!Array.isArray(inputImages)) {
            return NextResponse.json(
                { error: 'inputImages must be an array' },
                { status: 400 }
            )
        }
        // Filter out invalid URLs
        validInputImages = inputImages.filter(url => url && typeof url === 'string' && url.trim() !== '')
    }

    // Validate input image count (GPT Image 1.5 recommended max)
    if (validInputImages.length > 9) {
        return NextResponse.json(
            { error: 'Max 9 input images (+ 1 template = 10 total) for stability' },
            { status: 400 }
        )
    }

    try {

        console.log('🚀 Starting GPT Image 1.5 with Template (Single Job):', { 
            jobId, 
            inputImageCount: validInputImages.length, 
            templateUrl 
        })

        // 🛡️ GUARD: Check if job already has a prediction (prevent duplicates on retry)
        const { data: existingJob } = await supabaseAdmin
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

        // เตรียม prompt สำหรับ template mode
        const templatePrompt = `- ใช้รูปแรกเป็น Template อ้างอิง รักษาโครงเลย์เอาต์ สัดส่วน กริด มาร์จิน ระยะห่าง โทนสี สไตล์กราฟิก เอฟเฟกต์เงา/ไลต์/กราเดียนต์ และองค์ประกอบตกแต่งทั้งหมดให้คงเดิม 100%
- ปรับแก้รูปภาพที่เหลือตามคำสั่งต่อไปนี้: ${prompt}
- จัดวางรูปภาพทั้งหมดตามลำดับเดิม โดย:
  - รูปที่แก้ไขเป็นรูปถัดจาก Template ให้ใช้เป็นรูป Hero (ขนาดใหญ่ที่สุดใน Template)
  - รูปอื่นๆ วางต่อเนื่องตามลำดับให้ตรงกับตำแหน่ง/สัดส่วนเดิมของ Template
- ลบข้อความ ตัวอักษร ตัวเลข ไอคอนโลโก้ ลายน้ำ และเครื่องหมายการค้าทั้งหมดออกจากทุกภาพอย่างสะอาด เนียนตา โดยคงพื้นผิว/พื้นหลังเดิมให้สมจริง
- หากมีข้อความใน Template เดิม ให้ลบออกทั้งหมดและคงพื้นที่ว่าง/พื้นหลังให้สอดคล้องกับดีไซน์เดิม
- คงความคมชัด สีสัน และโทนแสงให้ใกล้เคียงรูปต้นฉบับของ Template และทำการแมตช์โทนสีของรูปที่เหลือให้สอดคล้องกัน
- ปรับสัดส่วนภาพอัตโนมัติให้พอดีกับช่องใน Template โดยไม่บิดเบี้ยว (ใช้ fill/crop แบบคงสัดส่วน, จัดวาง subject ให้เด่นและไม่ถูกครอปส่วนสำคัญ)
- หากองค์ประกอบบางภาพไม่พอดีกับช่อง ให้จัดคอมโพสใหม่เล็กน้อยภายในกรอบเดิมโดยไม่เปลี่ยนเลย์เอาต์รวม
- หลีกเลี่ยงการเพิ่มข้อความใหม่หรือโลโก้ใดๆ ในทุกขั้นตอน
`

        // รวม template + input images ทั้งหมดเป็น array เดียว
        const allInputImages = [templateUrl, ...validInputImages]
        
        console.log(`📸 Creating single GPT Image 1.5 prediction with ${allInputImages.length} images`)

        // สร้าง input ตาม GPT Image 1.5 API specification
        const gptInput: Record<string, unknown> = {
            prompt: templatePrompt,
            input_images: allInputImages,
            aspect_ratio: aspectRatio || '1:1',
            number_of_images: 1,
            quality: quality || 'auto',
            output_format: outputFormat || 'webp',
            output_compression: outputCompression || 90,
            moderation: moderation || 'auto',
            background: background || 'auto',
            input_fidelity: inputFidelity || 'low', // Low = creative freedom, High = strict adherence
        }

        // Retry logic for Replicate API (max 3 attempts)
        let prediction
        const maxRetries = 3

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                prediction = await replicate.predictions.create({
                    model: 'openai/gpt-image-1.5',
                    input: gptInput,
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
                
                const isRateLimit = error?.response?.status === 429
                const backoffMs = isRateLimit ? 2000 * attempt : 1000 * attempt
                
                console.log(`⚠️ Attempt ${attempt} failed (${isRateLimit ? 'rate limit' : 'error'}), retrying in ${backoffMs}ms...`)
                await new Promise(resolve => setTimeout(resolve, backoffMs))
            }
        }

        if (!prediction) {
            throw new Error('Prediction is undefined after retries')
        }

        console.log('✅ GPT Image 1.5 prediction created:', prediction.id)

        // Update job with prediction ID and targetAspectRatio in metadata
        const updateData: Record<string, unknown> = {
            replicate_id: prediction.id,
            status: 'processing',
        }
        
        // 🔥 Store targetAspectRatio in metadata for webhook to crop later
        if (targetAspectRatio) {
            // Fetch existing metadata to merge (prevent overwrite)
            const { data: existingJob } = await supabaseAdmin
                .from('jobs')
                .select('metadata')
                .eq('id', jobId)
                .single()
            
            const existingMetadata = (existingJob?.metadata as Record<string, unknown>) || {}
            updateData.metadata = { ...existingMetadata, targetAspectRatio }
            console.log('📐 Will crop to:', targetAspectRatio)
        }
        
        const { error: updateError } = await supabaseAdmin
            .from('jobs')
            .update(updateData)
            .eq('id', jobId)

        if (updateError) {
            console.error('❌ Failed to update job:', updateError)
            throw new Error('Failed to save job')
        }
        
        console.log('✅ Job created with single prediction:', prediction.id)

        return NextResponse.json({
            success: true,
            message: 'GPT Image 1.5 with template processing...',
            predictionId: prediction.id,
            jobId: jobId,
        })

    } catch (error: unknown) {
        console.error('Pipeline error:', error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        // Update job status to failed
        if (jobId) {
            try {
                await supabaseAdmin
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
