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
    const { jobId, prompt, templateUrl, aspectRatio, numberOfImages, inputImages } = body

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

    try {

        console.log('🚀 Starting GPT → Template Pipeline:', { jobId, numberOfImages, inputImageCount: inputImages?.length || 0, templateUrl })

        // ======= STEP 1: GPT Image 1.5 (แยกรูปทีละรูปแต่ไม่ wait) =======
        console.log('📸 Step 1: Creating GPT Image 1.5 predictions...')
        
        const gptPredictionIds: string[] = []

        if (inputImages && inputImages.length > 0) {
            // ส่งทีละรูป แต่ไม่ wait (สร้าง predictions พร้อมกัน)
            console.log(`🔄 Creating ${inputImages.length} separate predictions...`)
            
            for (let i = 0; i < inputImages.length; i++) {
                let retryCount = 0
                const maxRetries = 3
                let success = false
                
                while (!success && retryCount <= maxRetries) {
                    try {
                        const singleInput: Record<string, unknown> = {
                            prompt: prompt,
                            aspect_ratio: aspectRatio || '1:1',
                            number_of_images: 1,
                            quality: 'auto', // hardcode เพื่อป้องกัน upscale error
                            output_format: 'webp', // ไฟล์เล็ก คุณภาพดี
                            input_images: [inputImages[i]], // ส่งทีละรูป
                        }

                        const gptPrediction = await replicate.predictions.create({
                            model: 'openai/gpt-image-1.5',
                            input: singleInput,
                            webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
                            webhook_events_filter: ['completed'],
                        })

                        gptPredictionIds.push(gptPrediction.id)
                        console.log(`  ✅ Prediction ${i + 1}/${inputImages.length} created:`, gptPrediction.id)
                        success = true
                    } catch (predError: unknown) {
                        // Check if it's a rate limit error (429)
                        const error = predError as { response?: { status?: number; headers?: { get: (key: string) => string | null } }; message?: string }
                        if (error?.response?.status === 429) {
                            retryCount++
                            const retryAfter = error?.response?.headers?.get('retry-after') || '10'
                            const waitTime = parseInt(retryAfter) * 1000 + 1000 // Add 1s buffer
                            
                            if (retryCount <= maxRetries) {
                                console.log(`  ⏳ Rate limit hit. Waiting ${waitTime/1000}s before retry ${retryCount}/${maxRetries}...`)
                                await new Promise(resolve => setTimeout(resolve, waitTime))
                            } else {
                                console.error(`  ❌ Failed after ${maxRetries} retries for prediction ${i + 1}:`, error.message)
                                throw new Error(`Rate limit exceeded for image ${i + 1} after ${maxRetries} retries`)
                            }
                        } else {
                            // Non-rate-limit error, throw immediately
                            console.error(`  ❌ Failed to create prediction ${i + 1}:`, error)
                            throw new Error(`Failed to create prediction for image ${i + 1}: ${error.message || 'Unknown error'}`)
                        }
                    }
                }
            }
        } else {
            // ไม่มี input images -> เจนทีละรูปเหมือนกัน (เพื่อให้ได้รูปแยก)
            const imagesToGenerate = numberOfImages || 1
            console.log(`🔄 Creating ${imagesToGenerate} predictions without input images...`)
            
            for (let i = 0; i < imagesToGenerate; i++) {
                try {
                    const gptInput: Record<string, unknown> = {
                        prompt: prompt,
                        aspect_ratio: aspectRatio || '1:1',
                        number_of_images: 1, // เจนทีละรูป
                    }

                    const gptPrediction = await replicate.predictions.create({
                        model: 'openai/gpt-image-1.5',
                        input: gptInput,
                        webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
                        webhook_events_filter: ['completed'],
                    })

                    gptPredictionIds.push(gptPrediction.id)
                    console.log(`  ✅ Prediction ${i + 1}/${imagesToGenerate} created:`, gptPrediction.id)
                } catch (predError) {
                    console.error(`  ❌ Failed to create prediction ${i + 1}:`, predError)
                    throw new Error(`Failed to create prediction for image ${i + 1}`)
                }
            }
        }

        console.log('✅ All GPT Image predictions created:', gptPredictionIds.length)

        // Validate predictions were created
        if (gptPredictionIds.length === 0) {
            throw new Error('No predictions were created')
        }

        // บันทึก job metadata สำหรับ webhook (ใช้ service role เพื่อ bypass RLS)
        const { error: updateError } = await supabaseAdmin
            .from('jobs')
            .update({
                status: 'processing',
                // เก็บ metadata สำหรับ webhook รวบรวมผล
                metadata: {
                    pipeline: 'gpt-with-template',
                    templateUrl: templateUrl,
                    step: 1,
                    prompt: prompt,
                    aspectRatio: aspectRatio, // เก็บ aspect ratio ไว้ใช้ step 2
                    gptPredictions: gptPredictionIds,
                    totalPredictions: gptPredictionIds.length,
                    completedPredictions: [], // webhook จะเพิ่มเมื่อเสร็จ
                }
            })
            .eq('id', jobId)

        if (updateError) {
            console.error('❌ Failed to update job metadata:', updateError)
            throw new Error('Failed to save job metadata')
        }
        
        console.log('✅ Job metadata saved:', { jobId, gptPredictionIds })

        // Return ทันที (webhook จะจัดการต่อ)
        return NextResponse.json({
            success: true,
            message: `Pipeline started - ${gptPredictionIds.length} GPT Image predictions processing...`,
            gptPredictionIds: gptPredictionIds,
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
