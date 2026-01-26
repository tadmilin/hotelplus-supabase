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
        outputCompression
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

        // เตรียม prompt สำหรับ template mode
        const templatePrompt = `ใช้รูปแรกเป็น template รักษา layoutและดีไซน์ไว้คงเดิมทั้งหมด แก้ไขรูปภาพที่เหลือตามคำสั่ง: ${prompt} จากนั้นวางรูปที่เหลือทั้งหมดตามลำดับโดยให้รูปที่แก้ไขรูปแรก(รูปถัดจากtemplate)เป็นรูปheroหรือรูปใหญ่ที่สุดในtemplateและลบข้อความตัวอักษรตัวเลขโลโก้ทั้งหมดออกจากภาพให้ด้วย`

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

        // Update job with prediction ID (ไม่ต้องใช้ pipeline metadata)
        const { error: updateError } = await supabaseAdmin
            .from('jobs')
            .update({
                replicate_id: prediction.id,
                status: 'processing',
            })
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
