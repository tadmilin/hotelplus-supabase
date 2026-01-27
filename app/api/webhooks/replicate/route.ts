import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import replicate from '@/lib/replicate'
import { uploadToCloudinaryFullSize, uploadAndCropToAspectRatio } from '@/lib/cloudinary'
import crypto from 'crypto'

// Vercel Pro plan: max 300 seconds (5 minutes)
// Webhook needs time for: download (30s) + compress (2s) + upload (28s) = ~60s
export const maxDuration = 300

// Create Supabase client with service role key for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// Auto-export job to Google Sheets
async function exportJobToSheets(jobId: string) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  
  if (!webhookUrl) {
    console.log('⚠️ GOOGLE_SHEETS_WEBHOOK_URL not configured, skipping export')
    return
  }

  try {
    // Fetch the completed job
    const { data: job, error: jobError } = await supabaseAdmin
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      console.error('❌ Failed to fetch job for export:', jobError)
      return
    }

    const createdAt = new Date(job.created_at)
    const completedAt = job.completed_at ? new Date(job.completed_at) : null
    const duration = completedAt 
      ? Math.round((completedAt.getTime() - createdAt.getTime()) / 60000) 
      : null

    // Send data to Apps Script
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        userName: job.user_name || '',
        userEmail: job.user_email || '',
        jobType: job.job_type || '',
        status: job.status || '',
        prompt: job.prompt || '',
        templateType: job.template_type || '',
        outputSize: job.output_size || '',
        inputCount: (job.image_urls || []).length,
        outputCount: (job.output_urls || []).length,
        createdAt: createdAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
        completedAt: completedAt ? completedAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '',
        duration: duration || '',
        replicateId: job.replicate_id || '',
        error: job.error || ''
      })
    })

    if (response.ok) {
      console.log('✅ Exported job to Google Sheets:', jobId)
    } else {
      console.error('⚠️ Failed to export to Google Sheets:', await response.text())
    }
  } catch (error) {
    console.error('⚠️ Failed to export to Google Sheets (non-critical):', error)
  }
}

export async function POST(req: NextRequest) {
  try {
    // Verify webhook signature using Replicate's signing secret
    const webhookSecret = process.env.REPLICATE_WEBHOOK_SECRET
    const isDevelopment = process.env.NODE_ENV === 'development'
    
    interface WebhookPayload {
      id: string
      status: string
      output?: unknown
      error?: unknown
    }

    let webhook: WebhookPayload | null = null
    
    if (webhookSecret && !isDevelopment) {
      // PRODUCTION MODE: Full signature verification
      const signature = req.headers.get('webhook-signature')
      const webhookId = req.headers.get('webhook-id')
      const webhookTimestamp = req.headers.get('webhook-timestamp')
      
      if (!signature || !webhookId || !webhookTimestamp) {
        console.error('❌ Missing webhook headers')
        
        // Try to parse body to get prediction ID and mark job as failed
        try {
          const bodyText = await req.text()
          const bodyData = JSON.parse(bodyText) as { id?: string }
          
          if (bodyData.id) {
            const { data: jobs } = await supabaseAdmin
              .from('jobs')
              .select('id')
              .eq('replicate_id', bodyData.id)
              .limit(1)
            
            if (jobs && jobs.length > 0) {
              await supabaseAdmin
                .from('jobs')
                .update({
                  status: 'failed',
                  error: 'Webhook verification failed - missing signature headers',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', jobs[0].id)
              
              console.log('✅ Marked job as failed due to missing webhook headers')
            }
          }
        } catch (parseError) {
          console.error('Failed to parse webhook body for fallback:', parseError)
        }
        
        return NextResponse.json({ error: 'Missing webhook headers' }, { status: 401 })
      }
      
      // Replicate uses Svix standard. Secret starting with "whsec_" is base64 encoded.
      const body = await req.text()
      const signedContent = `${webhookId}.${webhookTimestamp}.${body}`

      // Handle Svix secret format (decode if whsec_ prefix exists)
      const secretKey = webhookSecret.startsWith('whsec_') 
        ? Buffer.from(webhookSecret.substring(6), 'base64')
        : webhookSecret

      const expectedSignature = crypto.createHmac('sha256', secretKey)
        .update(signedContent, 'utf8')
        .digest('base64')
      
      // Extract actual signature (remove "v1," prefix if exists)
      const actualSignature = signature.includes(',') ? signature.split(',')[1] : signature
      
      if (expectedSignature !== actualSignature) {
        console.error('❌ Invalid webhook signature', {
          expected: expectedSignature.substring(0, 20) + '...',
          actual: actualSignature.substring(0, 20) + '...',
        })
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
      
      console.log('✅ Webhook signature verified')
      
      // Parse body for use below
      webhook = JSON.parse(body)
    } else {
      // DEVELOPMENT MODE: Skip verification
      if (webhookSecret && isDevelopment) {
        const signature = req.headers.get('webhook-signature')
        const webhookId = req.headers.get('webhook-id')
        const webhookTimestamp = req.headers.get('webhook-timestamp')
        
        if (signature && webhookId && webhookTimestamp) {
          console.log('🔓 Development mode - webhook signature verification skipped')
        }
      }
      
      // Parse webhook data
      webhook = await req.json()
    }
    
    console.log('📨 Webhook received:', {
      id: webhook?.id,
      status: webhook?.status,
      hasOutput: !!webhook?.output,
    })

    const replicateId = webhook?.id
    const status = webhook?.status
    const output = webhook?.output
    const error = webhook?.error

    if (!replicateId) {
      console.error('❌ No replicate_id in webhook')
      return NextResponse.json({ error: 'No replicate_id' }, { status: 400 })
    }

    // Find job by replicate_id
    const { data: jobs, error: findError } = await supabaseAdmin
      .from('jobs')
      .select('*')
      .eq('replicate_id', replicateId)
      .limit(1)

    if (findError) {
      console.error('❌ Error finding job:', findError)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // ถ้าไม่เจอ job จาก replicate_id ให้ลองหาจาก metadata.gptPredictions
    let job = jobs && jobs.length > 0 ? jobs[0] : null
    
    if (!job) {
      console.log('🔍 No job found by replicate_id, searching in metadata...')
      // ค้นหา job ที่มี gptPredictions ใน metadata (pipeline jobs)
      // Filter เฉพาะ pending/processing และ created ใน 24 ชม. ล่าสุด
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: metadataJobs } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .not('metadata', 'is', null)
        .in('status', ['pending', 'processing', 'processing_template'])
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(200)
      
      if (metadataJobs) {
        job = metadataJobs.find(j => {
          const meta = j.metadata as { gptPredictions?: string[] } | null
          return meta?.gptPredictions?.includes(replicateId)
        }) || null
        
        if (job) {
          console.log('✅ Found job in metadata search:', job.id)
        }
      }
    }

    if (!job) {
      console.error('❌ No job found with replicate_id:', replicateId)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    console.log('✅ Job found:', job.id)

    // Process webhook based on status
    if (status === 'succeeded' || status === 'completed') {
      // Extract output URLs
      let outputUrls: string[] = []
      
      if (Array.isArray(output)) {
        outputUrls = output
      } else if (typeof output === 'string') {
        outputUrls = [output]
      } else if (output && typeof output === 'object') {
        // Handle different output formats
        const outputObj = output as Record<string, unknown>
        if ('output' in outputObj) {
          const nested = outputObj.output
          outputUrls = Array.isArray(nested) ? nested as string[] : [nested as string]
        } else if ('images' in outputObj) {
          const images = outputObj.images
          outputUrls = Array.isArray(images) ? images as string[] : [images as string]
        }
      }

      console.log('✅ Job succeeded:', {
        jobId: job.id,
        outputCount: outputUrls.length,
      })

      // 🔍 Check if this is part of gpt-with-template pipeline (multiple predictions)
      const metadata = job.metadata as { 
        pipeline?: string; 
        templateUrl?: string; 
        step?: number; 
        prompt?: string;
        aspectRatio?: string;
        gptPredictions?: string[];
        totalPredictions?: number;
        targetAspectRatio?: string; // 🔥 เพิ่มสำหรับ crop
        // completedPredictions ย้ายไปเก็บใน job_predictions table แล้ว
      } | null
      
      if (metadata?.pipeline === 'gpt-with-template' && metadata?.step === 1 && webhook) {
        // ตรวจสอบว่า prediction นี้อยู่ใน list หรือไม่
        const isPartOfBatch = metadata.gptPredictions?.includes(webhook.id)
        
        if (isPartOfBatch) {
          console.log('🔄 GPT Image batch: prediction completed', webhook.id)
          
          // 🔥 Check if we need to crop (pipeline mode)
          const batchTargetRatio = metadata.targetAspectRatio
          
          // อัพโหลดรูปไป Cloudinary (พร้อม crop ถ้ามี targetAspectRatio)
          const permanentUrls: string[] = []
          for (const tempUrl of outputUrls) {
            try {
              let url: string
              if (batchTargetRatio) {
                url = await uploadAndCropToAspectRatio(tempUrl, batchTargetRatio, 'replicate-outputs')
              } else {
                url = await uploadToCloudinaryFullSize(tempUrl, 'replicate-outputs')
              }
              permanentUrls.push(url)
            } catch {
              permanentUrls.push(tempUrl)
            }
          }
          
          // ✅ ใช้ INSERT เข้า job_predictions table (atomic, ไม่มี race condition)
          // UNIQUE(job_id, prediction_id) ป้องกัน duplicate อัตโนมัติ
          const { error: insertError } = await supabaseAdmin
            .from('job_predictions')
            .insert({
              job_id: job.id,
              prediction_id: webhook.id,
              urls: permanentUrls,
            })
          
          if (insertError) {
            // ถ้า duplicate (UNIQUE constraint) ให้ skip ไม่ต้องทำซ้ำ
            if (insertError.code === '23505') {
              console.log('⚠️ Prediction already processed (duplicate key), skipping:', webhook.id)
              return NextResponse.json({ received: true, skipped: true })
            }
            console.error('❌ Failed to insert job_prediction:', insertError)
            throw insertError
          }
          
          console.log('✅ Inserted prediction to job_predictions:', webhook.id)
          
          // นับจำนวน predictions ที่เสร็จแล้ว (atomic count)
          const { count: completedCount } = await supabaseAdmin
            .from('job_predictions')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', job.id)
          
          console.log(`📊 Progress: ${completedCount}/${metadata.totalPredictions}`)
          
          // เช็คว่าครบทุก predictions แล้วหรือยัง
          if (completedCount === metadata.totalPredictions) {
            console.log('✅ All GPT Image predictions completed - Attempting to start Step 2')
            
            // ⚠️ ป้องกัน race condition: ใช้ atomic UPDATE กับ condition
            // เฉพาะ webhook แรกที่ UPDATE สำเร็จเท่านั้นที่จะเริ่ม Step 2
            const { data: lockResult, error: lockError } = await supabaseAdmin
              .from('jobs')
              .update({ 
                status: 'processing_template',
                updated_at: new Date().toISOString()
              })
              .eq('id', job.id)
              .eq('status', 'processing') // ต้องยังเป็น processing อยู่
              .select('id')
              .single()
            
            if (lockError || !lockResult) {
              // webhook อื่นเริ่ม Step 2 ไปแล้ว
              console.log('⚠️ Step 2 already started by another webhook, skipping')
              
              // Double-check: ถ้าครบทุก predictions แล้วแต่ job ยังค้าง processing_template
              // อาจเป็น edge case ที่ Step 2 failed ก่อนหน้า
              const { data: currentJob } = await supabaseAdmin
                .from('jobs')
                .select('status, replicate_id')
                .eq('id', job.id)
                .single()
              
              if (currentJob?.status === 'processing_template') {
                console.log('🔍 Job stuck in processing_template, checking Step 2 status...')
                
                // Check if Step 2 prediction exists and its status
                if (currentJob.replicate_id) {
                  try {
                    const step2Prediction = await replicate.predictions.get(currentJob.replicate_id)
                    
                    if (step2Prediction.status === 'failed' || step2Prediction.status === 'canceled') {
                      console.log('⚠️ Step 2 failed, falling back to GPT results only')
                      
                      // Retrieve all GPT URLs and mark as completed
                      const { data: allPredictions } = await supabaseAdmin
                        .from('job_predictions')
                        .select('urls')
                        .eq('job_id', job.id)
                      
                      const allGptUrls = allPredictions?.flatMap(p => p.urls) || []
                      
                      await supabaseAdmin
                        .from('jobs')
                        .update({
                          status: 'completed',
                          output_urls: allGptUrls,
                          error: 'Template step failed, using GPT results',
                          completed_at: new Date().toISOString(),
                        })
                        .eq('id', job.id)
                      
                      console.log('✅ Job recovered with GPT results')
                    }
                  } catch (checkError) {
                    console.error('Failed to check Step 2 status:', checkError)
                  }
                }
              }
              
              return NextResponse.json({ received: true, skipped: true })
            }
            
            console.log('🔒 Lock acquired - Starting Step 2')
            
            // ดึง URLs ทั้งหมดจาก job_predictions
            const { data: allPredictions } = await supabaseAdmin
              .from('job_predictions')
              .select('urls')
              .eq('job_id', job.id)
            
            const allGptUrls = allPredictions?.flatMap(p => p.urls) || []
            
            // Update job with GPT results
            await supabaseAdmin
              .from('jobs')
              .update({
                output_urls: allGptUrls,
              })
              .eq('id', job.id)
            
            // สร้าง Step 2: GPT Image 1.5 with Template
            const templatePrompt = `ใช้ภาพแรกเป็นภาพอ้างอิงเฉพาะโครงสร้างและเลย์เอาต์ของดีไซน์เท่านั้น
คงรูปแบบการจัดวางไว้เหมือนเดิม แต่ลบข้อความ ตัวอักษร และโลโก้ทั้งหมดออก

นำภาพที่เหลือมาแทนที่รูปเดิมในภาพอ้างอิงตามลำดับอย่างครบถ้วน
ไม่ให้มีภาพหรือองค์ประกอบใดจากภาพแรกหลงเหลืออยู่ในผลลัพธ์
`

            const gptTemplateInput = {
              prompt: templatePrompt,
              input_images: [metadata.templateUrl, ...allGptUrls],
              aspect_ratio: metadata.aspectRatio || '1:1', // ใช้ค่าเดียวกับ step 1
              number_of_images: 1,
              quality: 'auto', // hardcode เพื่อป้องกัน upscale error
              output_format: 'webp', // ไฟล์เล็ก คุณภาพดี
            }

            try {
              const gptTemplatePrediction = await replicate.predictions.create({
                model: 'openai/gpt-image-1.5',
                input: gptTemplateInput,
                webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
                webhook_events_filter: ['completed'],
              })

              // Update with GPT Template prediction ID and step 2
              await supabaseAdmin
                .from('jobs')
                .update({
                  replicate_id: gptTemplatePrediction.id,
                  metadata: { ...metadata, step: 2, templateStartedAt: new Date().toISOString() }
                })
                .eq('id', job.id)

              console.log('✅ Step 2 (GPT Template) started:', gptTemplatePrediction.id)
            } catch (error) {
              console.error('❌ Step 2 failed:', error)
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              // Fallback: Mark as completed with GPT results only
              await supabaseAdmin
                .from('jobs')
                .update({
                  status: 'completed',
                  completed_at: new Date().toISOString(),
                  error: `Template step failed: ${errorMsg}. GPT results saved.`,
                })
                .eq('id', job.id)
            }
          } else {
            console.log(`⏳ Waiting for more predictions: ${completedCount}/${metadata.totalPredictions}`)
          }
          
          return NextResponse.json({ success: true })
        }
      }

      // 🔥 Check if we need to crop to target aspect ratio
      const jobMetadata = job.metadata as { targetAspectRatio?: string; pipeline?: string; step?: number } | null
      const targetAspectRatio = jobMetadata?.targetAspectRatio
      
      if (targetAspectRatio) {
        console.log(`📐 Target aspect ratio: ${targetAspectRatio} - will crop after upload`)
      }

      // อัพโหลดรูปไป Cloudinary เพื่อเก็บถาวร (Replicate URLs หมดอายุ!)
      // ถ้ามี targetAspectRatio จะ crop ด้วย
      const permanentUrls: string[] = []
      for (const tempUrl of outputUrls) {
        let uploadedUrl = ''
        
        // Retry Cloudinary upload with exponential backoff
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            console.log(`📤 Uploading to Cloudinary (attempt ${attempt}/2):`, tempUrl.substring(0, 50) + '...')
            
            // 🔥 If we have a target aspect ratio, crop during upload
            if (targetAspectRatio) {
              uploadedUrl = await uploadAndCropToAspectRatio(tempUrl, targetAspectRatio, 'replicate-outputs')
            } else {
              uploadedUrl = await uploadToCloudinaryFullSize(tempUrl, 'replicate-outputs')
            }
            
            permanentUrls.push(uploadedUrl)
            console.log('✅ Upload successful')
            break
          } catch (uploadError) {
            const isLastAttempt = attempt === 2
            
            if (isLastAttempt) {
              console.error('❌ Cloudinary upload failed after all retries:', uploadError)
              const errorMsg = uploadError instanceof Error ? uploadError.message : 'Unknown error'
              // Mark job as failed - ห้ามใช้ temp URL
              await supabaseAdmin
                .from('jobs')
                .update({
                  status: 'failed',
                  error: `Failed to upload output to permanent storage: ${errorMsg}`,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', job.id)
              return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
            }
            
            // Wait before retry (exponential backoff)
            const backoffMs = 2000 * attempt
            console.log(`🔄 Retrying in ${backoffMs}ms...`)
            await new Promise(resolve => setTimeout(resolve, backoffMs))
          }
        }
      }

      // Update job with output URLs
      const { error: updateError } = await supabaseAdmin
        .from('jobs')
        .update({
          status: 'completed',
          output_urls: permanentUrls, // ใช้ Cloudinary URLs แทน
          error: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      if (updateError) {
        console.error('❌ Error updating job:', updateError)
        return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
      }

      console.log('✅ Job updated successfully')

      // 📊 Auto-export to Google Sheets
      await exportJobToSheets(job.id)

      // Auto-upscale x2 for non-upscale jobs (text-to-image, custom-prompt, gpt-image, gpt-with-template, etc.)
      const nonUpscaleTypes = ['text-to-image', 'custom-prompt', 'custom-template', 'custom-prompt-template', 'gpt-image', 'gpt-with-template']
      if (nonUpscaleTypes.includes(job.job_type) && permanentUrls.length > 0) {
        console.log('🔍 Starting auto-upscale x2 for job:', job.id)
        
        try {
          // 🔥 Use permanentUrls (Cloudinary URLs that are already cropped if targetAspectRatio was set)
          // This ensures upscale uses the final cropped image, not the temp URL
          const urlsToUpscale = permanentUrls

          // Create upscale jobs for each output
          for (const imageUrl of urlsToUpscale) {
            const { data: upscaleJob } = await supabaseAdmin
              .from('jobs')
              .insert({
                user_id: job.user_id,
                user_name: job.user_name,
                user_email: job.user_email,
                job_type: 'upscale',
                status: 'processing',
                prompt: `Auto-upscale x2 from job ${job.id}`,
                output_size: 'x2',
                image_urls: [imageUrl],
                input_image_url: imageUrl, // 🔥 ใช้ Cloudinary URL (ไม่หมดอายุ)
                output_urls: [],
              })
              .select()
              .single()

            if (upscaleJob) {
              // Call Replicate API directly (more reliable than self-fetch)
              console.log('🚀 Triggering Replicate Upscale for:', upscaleJob.id)
              
              // 🔍 Check if we should use A100 for large images
              // Real-ESRGAN on T4 GPU limit: ~1448x1448 pixels (2,096,704 total)
              // If input is 2K (2048x2048 = 4.1M pixels), use A100 version
              const useA100 = false // TODO: Add image size check if needed
              const model = useA100 ? 'daanelson/real-esrgan-a100' : 'nightmareai/real-esrgan'
              
              const prediction = await replicate.predictions.create({
                model: model,
                input: {
                  image: imageUrl, // 🔥 ใช้ Cloudinary URL (cropped if applicable)
                  scale: 2,
                  face_enhance: true, // ✅ เปิดอัตโนมัติสำหรับ auto-upscale (แก้หน้าคน)
                },
                webhook: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/replicate`,
                webhook_events_filter: ['completed'],
              })

              // Update job with replicate_id immediately
              await supabaseAdmin
                .from('jobs')
                .update({ replicate_id: prediction.id })
                .eq('id', upscaleJob.id)
                
              console.log('✅ Upscale started, ID:', prediction.id)
            }
          }
          
          console.log('✅ Auto-upscale jobs created')
        } catch (upscaleError) {
          console.error('⚠️ Auto-upscale error (non-critical):', upscaleError)
        }
      }

      return NextResponse.json({ success: true })

    } else if (status === 'failed' || status === 'canceled') {
      console.log('❌ Job failed:', {
        jobId: job.id,
        error: error || 'Unknown error',
      })

      // Update job with error
      const { error: updateError } = await supabaseAdmin
        .from('jobs')
        .update({
          status: 'failed',
          error: error || 'Job failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      if (updateError) {
        console.error('❌ Error updating job:', updateError)
        return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
      }

      console.log('✅ Job marked as failed')
      return NextResponse.json({ success: true })

    } else if (status === 'processing' || status === 'starting') {
      // Calculate estimated progress based on elapsed time
      const createdAt = new Date(job.created_at).getTime()
      const now = Date.now()
      const elapsed = (now - createdAt) / 1000 // seconds
      
      // Estimate: most jobs take 20-60 seconds
      // starting: 0-10%, processing: 10-90%
      let progress = 0
      if (status === 'starting') {
        progress = Math.min(10, (elapsed / 60) * 100)
      } else {
        progress = Math.min(90, 10 + (elapsed / 40) * 80)
      }
      progress = Math.round(progress)
      
      console.log('⏳ Job still processing:', {
        jobId: job.id,
        status: status,
        progress: `${progress}%`,
        elapsed: `${elapsed.toFixed(1)}s`,
      })

      // Update status only
      const { error: updateError } = await supabaseAdmin
        .from('jobs')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      if (updateError) {
        console.error('❌ Error updating job:', updateError)
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('❌ Webhook error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Allow GET for webhook verification (if needed)
export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    message: 'Webhook endpoint is active',
    timestamp: new Date().toISOString(),
  })
}
