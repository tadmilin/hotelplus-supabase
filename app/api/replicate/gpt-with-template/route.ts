import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN!,
})

export async function POST(request: NextRequest) {
    const body = await request.json()
    const { jobId, prompt, templateUrl, aspectRatio, numberOfImages, quality, outputFormat, background, moderation, inputFidelity, outputCompression, inputImages } = body

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
        
        const supabase = await createClient()

        // ======= STEP 1: GPT Image 1.5 (แยกรูปทีละรูปแต่ไม่ wait) =======
        console.log('📸 Step 1: Creating GPT Image 1.5 predictions...')
        
        const gptPredictionIds: string[] = []

        if (inputImages && inputImages.length > 0) {
            // ส่งทีละรูป แต่ไม่ wait (สร้าง predictions พร้อมกัน)
            console.log(`🔄 Creating ${inputImages.length} separate predictions...`)
            
            for (let i = 0; i < inputImages.length; i++) {
                try {
                    const singleInput: Record<string, unknown> = {
                        prompt: prompt,
                        aspect_ratio: aspectRatio || '1:1',
                        number_of_images: 1,
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
                        webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
                        webhook_events_filter: ['completed'],
                    })

                    gptPredictionIds.push(gptPrediction.id)
                    console.log(`  ✅ Prediction ${i + 1}/${inputImages.length} created:`, gptPrediction.id)
                } catch (predError) {
                    console.error(`  ❌ Failed to create prediction ${i + 1}:`, predError)
                    throw new Error(`Failed to create prediction for image ${i + 1}`)
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
                webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
                webhook_events_filter: ['completed'],
            })

            gptPredictionIds.push(gptPrediction.id)
            console.log('✅ Single prediction created:', gptPrediction.id)
        }

        console.log('✅ All GPT Image predictions created:', gptPredictionIds.length)

        // Validate predictions were created
        if (gptPredictionIds.length === 0) {
            throw new Error('No predictions were created')
        }

        // บันทึก job metadata สำหรับ webhook
        await supabase
            .from('jobs')
            .update({
                status: 'processing',
                // เก็บ metadata สำหรับ webhook รวบรวมผล
                metadata: {
                    pipeline: 'gpt-with-template',
                    templateUrl: templateUrl,
                    step: 1,
                    prompt: prompt,
                    gptPredictions: gptPredictionIds,
                    totalPredictions: gptPredictionIds.length,
                    completedPredictions: [], // webhook จะเพิ่มเมื่อเสร็จ
                }
            })
            .eq('id', jobId)

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
