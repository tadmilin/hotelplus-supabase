import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { uploadToCloudinaryFullSize } from '@/lib/cloudinary'
import { improvePrompt, seedreamEdit, appendNoTextInstructions } from '@/lib/freepik'
import crypto from 'crypto'

/**
 * Freepik Webhook Handler - Processes webhook chain for Seedream Edit
 * 
 * Steps:
 * 1. image-to-prompt → receives style prompt → triggers improve-prompt
 * 2. improve-prompt → receives improved prompt → triggers seedream-edit
 * 3. seedream-edit → receives image URLs → uploads to Cloudinary → completes job
 * 
 * Query params:
 * - step: 'image-to-prompt' | 'improve-prompt' | 'seedream-edit'
 * - jobId: UUID of the job
 */

// Vercel Pro: max 300 seconds for webhook processing
export const maxDuration = 300

// Create Supabase admin client for webhook operations
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

// Freepik webhook payload structure
interface FreepikWebhookPayload {
  task_id: string
  status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  generated?: string[]
  has_nsfw?: boolean[]
}

// Job metadata stored in database
interface JobMetadata {
  customPrompt: string
  imageUrls: string[]
  aspectRatio: string
  templateUrl: string | null
  enableImprovePrompt: boolean
  templatePrompt?: string // Added after image-to-prompt completes
  improvedPrompt?: string // Added after improve-prompt completes
}

/**
 * Verify Freepik webhook signature (Svix standard)
 */
function verifyWebhookSignature(
  body: string,
  webhookId: string | null,
  timestamp: string | null,
  signature: string | null,
  secret: string
): boolean {
  if (!webhookId || !timestamp || !signature) {
    return false
  }

  // Check timestamp to prevent replay attacks (5 min tolerance)
  const timestampNum = parseInt(timestamp, 10)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestampNum) > 300) {
    console.error('❌ Webhook timestamp too old or too far in future')
    return false
  }

  // Build signed content
  const signedContent = `${webhookId}.${timestamp}.${body}`

  // Handle Svix secret format (whsec_ prefix means base64)
  const secretKey = secret.startsWith('whsec_')
    ? Buffer.from(secret.substring(6), 'base64')
    : Buffer.from(secret)

  // Calculate expected signature
  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(signedContent, 'utf8')
    .digest('base64')

  // Signature header format: "v1,<base64> v2,<base64>"
  const signatures = signature.split(' ')
  for (const sig of signatures) {
    const [version, value] = sig.split(',')
    if (version === 'v1' && value === expectedSignature) {
      return true
    }
  }

  console.error('❌ Webhook signature mismatch')
  return false
}

/**
 * Export completed job to Google Sheets
 */
async function exportJobToSheets(jobId: string) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  
  if (!webhookUrl) {
    console.log('⚠️ GOOGLE_SHEETS_WEBHOOK_URL not configured, skipping export')
    return
  }

  try {
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

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        userName: job.user_name || '',
        userEmail: job.user_email || '',
        jobType: job.job_type || 'freepik-seedream',
        status: job.status || '',
        prompt: job.prompt || '',
        templateType: job.template_type || '',
        outputSize: job.output_size || '',
        inputCount: (job.image_urls || []).length,
        outputCount: (job.output_urls || []).length,
        createdAt: createdAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
        completedAt: completedAt ? completedAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '',
        duration: duration || '',
        freepikTaskId: job.freepik_task_id || '',
        error: job.error || ''
      })
    })

    if (response.ok) {
      console.log('✅ Exported Freepik job to Google Sheets:', jobId)
    } else {
      console.error('⚠️ Failed to export to Google Sheets:', await response.text())
    }
  } catch (error) {
    console.error('⚠️ Failed to export to Google Sheets (non-critical):', error)
  }
}

/**
 * Handle Step 1: Image to Prompt completed → Trigger Improve Prompt
 */
async function handleImageToPromptComplete(
  jobId: string,
  templatePrompt: string
): Promise<{ success: boolean; error?: string }> {
  console.log('🔍 Image to Prompt completed, triggering Improve Prompt...')
  
  try {
    const { data: job, error: jobError } = await supabaseAdmin
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error('Job not found')
    }

    const metadata = job.metadata as JobMetadata
    
    // Update metadata with template prompt
    const updatedMetadata: JobMetadata = {
      ...metadata,
      templatePrompt,
    }

    // Build webhook URL for next step
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    
    // Check if improve prompt is enabled
    if (metadata.enableImprovePrompt) {
      // Combine as edit instruction (not description)
      const editPrompt = `Edit the image: ${metadata.customPrompt}. Use the following style elements: ${templatePrompt.substring(0, 500)}`
      
      const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=improve-prompt&jobId=${jobId}`
      const result = await improvePrompt(editPrompt, 'image', webhookUrl)
      const taskId = result.data.task_id

      console.log('✅ Improve Prompt task created:', taskId)

      await supabaseAdmin
        .from('jobs')
        .update({
          freepik_task_id: taskId,
          freepik_status: 'IMPROVE_PROMPT',
          freepik_step: 'improve-prompt',
          metadata: updatedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return { success: true }
    }
    
    // Skip improve prompt → go directly to Seedream
    console.log('⏭️ Skipping Improve Prompt, going directly to Seedream...')
    
    // Simple edit instruction
    const finalPrompt = appendNoTextInstructions(
      `Edit the image: ${metadata.customPrompt}. Keep the original composition but apply changes as requested.`
    )
    
    const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=seedream-edit&jobId=${jobId}`
    
    // Validate reference images
    const validUrls = metadata.imageUrls.filter(url => {
      try {
        new URL(url)
        return url.startsWith('http://') || url.startsWith('https://')
      } catch {
        return false
      }
    })

    if (validUrls.length === 0) {
      throw new Error('No valid image URLs found')
    }
    
    const result = await seedreamEdit({
      prompt: finalPrompt,
      referenceImages: validUrls,
      webhookUrl,
      aspectRatio: metadata.aspectRatio as 'square_1_1' | 'widescreen_16_9' | 'social_story_9_16' | 'portrait_2_3' | 'traditional_3_4' | 'standard_3_2' | 'classic_4_3' | 'cinematic_21_9',
    })
    const taskId = result.data.task_id

    console.log('✅ Seedream Edit task created (from template):', taskId)

    await supabaseAdmin
      .from('jobs')
      .update({
        freepik_task_id: taskId,
        freepik_status: 'SEEDREAM_GENERATING',
        freepik_step: 'seedream-edit',
        prompt: finalPrompt,
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return { success: true }
  } catch (error) {
    console.error('❌ Failed to handle Image to Prompt:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Handle Step 2: Improve Prompt completed → Trigger Seedream Edit
 */
async function handleImprovePromptComplete(
  jobId: string,
  improvedPrompt: string
): Promise<{ success: boolean; error?: string }> {
  console.log('✨ Improve Prompt completed, triggering Seedream Edit...')
  
  try {
    const { data: job, error: jobError } = await supabaseAdmin
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error('Job not found')
    }

    const metadata = job.metadata as JobMetadata
    
    // Validate reference images
    if (!metadata.imageUrls || metadata.imageUrls.length === 0) {
      throw new Error('No reference images found in metadata')
    }

    if (metadata.imageUrls.length > 14) {
      throw new Error(`Too many reference images: ${metadata.imageUrls.length} (max 14)`)
    }

    // Validate image URLs
    const validUrls = metadata.imageUrls.filter(url => {
      try {
        new URL(url)
        return url.startsWith('http://') || url.startsWith('https://')
      } catch {
        return false
      }
    })

    if (validUrls.length === 0) {
      throw new Error('No valid image URLs found')
    }

    console.log(`✅ Validated ${validUrls.length} reference images`)
    
    // Append "no text" instructions
    const finalPrompt = appendNoTextInstructions(improvedPrompt)
    
    // Update metadata with improved prompt
    const updatedMetadata: JobMetadata = {
      ...metadata,
      improvedPrompt: finalPrompt,
    }

    // Build webhook URL for final step
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=seedream-edit&jobId=${jobId}`

    // Call Seedream Edit API with webhook
    const result = await seedreamEdit({
      prompt: finalPrompt,
      referenceImages: validUrls,
      webhookUrl,
      aspectRatio: metadata.aspectRatio as 'square_1_1' | 'widescreen_16_9' | 'social_story_9_16' | 'portrait_2_3' | 'traditional_3_4' | 'standard_3_2' | 'classic_4_3' | 'cinematic_21_9',
    })

    const taskId = result.data.task_id

    console.log('✅ Seedream Edit task created:', taskId)

    // Update job with final prompt
    await supabaseAdmin
      .from('jobs')
      .update({
        freepik_task_id: taskId,
        freepik_status: 'SEEDREAM_GENERATING',
        freepik_step: 'seedream-edit',
        prompt: finalPrompt,
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return { success: true }
  } catch (error) {
    console.error('❌ Failed to trigger Seedream Edit:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Handle Step 3: Seedream Edit completed → Upload to Cloudinary & Complete
 */
async function handleSeedreamComplete(
  jobId: string,
  imageUrls: string[],
  hasNsfw: boolean[]
): Promise<{ success: boolean; error?: string; outputCount?: number }> {
  console.log('🎨 Seedream Edit completed, uploading to Cloudinary...')
  
  try {
    // Check for NSFW content
    if (hasNsfw?.some(v => v === true)) {
      await supabaseAdmin
        .from('jobs')
        .update({
          status: 'failed',
          freepik_status: 'COMPLETED',
          freepik_step: 'completed',
          error: 'Content flagged as inappropriate',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return { success: false, error: 'NSFW content blocked' }
    }

    // Upload images to Cloudinary
    const uploadedUrls: string[] = []
    
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i]
      
      try {
        console.log(`📤 Uploading image ${i + 1}/${imageUrls.length}...`)
        
        const cloudinaryUrl = await uploadToCloudinaryFullSize(
          imageUrl,
          `freepik-seedream/${jobId}/output_${i + 1}`
        )
        
        uploadedUrls.push(cloudinaryUrl)
        console.log(`✅ Uploaded image ${i + 1}`)
      } catch (uploadError) {
        console.error(`❌ Failed to upload image ${i + 1}:`, uploadError)
        // Continue with other images
      }
    }

    if (uploadedUrls.length === 0) {
      await supabaseAdmin
        .from('jobs')
        .update({
          status: 'failed',
          freepik_status: 'COMPLETED',
          freepik_step: 'completed',
          error: 'Failed to upload images to Cloudinary',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return { success: false, error: 'Upload failed' }
    }

    // Update job as completed
    const completedAt = new Date().toISOString()
    
    await supabaseAdmin
      .from('jobs')
      .update({
        status: 'completed',
        freepik_status: 'COMPLETED',
        freepik_step: 'completed',
        output_urls: uploadedUrls,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('id', jobId)

    console.log(`✅ Job completed with ${uploadedUrls.length} images:`, jobId)

    // Export to Google Sheets (non-blocking)
    exportJobToSheets(jobId).catch(console.error)

    return { success: true, outputCount: uploadedUrls.length }
  } catch (error) {
    console.error('❌ Failed to complete Seedream job:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  
  try {
    // Get step and jobId from query params
    const { searchParams } = new URL(req.url)
    const step = searchParams.get('step') || 'seedream-edit'
    const jobIdFromQuery = searchParams.get('jobId')

    const webhookSecret = process.env.FREEPIK_WEBHOOK_SECRET
    const isDevelopment = process.env.NODE_ENV === 'development'
    
    const body = await req.text()

    // Verify signature in production
    if (webhookSecret && !isDevelopment) {
      const webhookId = req.headers.get('webhook-id')
      const timestamp = req.headers.get('webhook-timestamp')
      const signature = req.headers.get('webhook-signature')

      if (!verifyWebhookSignature(body, webhookId, timestamp, signature, webhookSecret)) {
        console.error('❌ Freepik webhook signature verification failed')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    // Parse webhook payload
    const webhook = JSON.parse(body) as FreepikWebhookPayload

    console.log('📥 Freepik Webhook received:', {
      step,
      jobId: jobIdFromQuery,
      taskId: webhook.task_id,
      status: webhook.status,
      generatedCount: webhook.generated?.length || 0,
    })

    // Find job - either by query param or by task_id
    let jobId = jobIdFromQuery
    
    if (!jobId) {
      const { data: jobs } = await supabaseAdmin
        .from('jobs')
        .select('id')
        .eq('freepik_task_id', webhook.task_id)
        .limit(1)
      
      if (jobs && jobs.length > 0) {
        jobId = jobs[0].id
      }
    }

    if (!jobId) {
      console.error('❌ Job not found for task:', webhook.task_id)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Handle non-completed statuses
    if (webhook.status === 'FAILED') {
      await supabaseAdmin
        .from('jobs')
        .update({
          status: 'failed',
          freepik_status: 'FAILED',
          error: `Freepik ${step} failed`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      console.log(`❌ ${step} failed for job:`, jobId)
      return NextResponse.json({ received: true, status: 'failed', step })
    }

    if (webhook.status === 'IN_PROGRESS' || webhook.status === 'CREATED') {
      console.log(`⏳ ${step} still in progress...`)
      return NextResponse.json({ received: true, status: webhook.status, step })
    }

    if (webhook.status !== 'COMPLETED') {
      console.log(`⏳ Unknown status: ${webhook.status}`)
      return NextResponse.json({ received: true, status: webhook.status, step })
    }

    // Handle COMPLETED based on step
    if (!webhook.generated || webhook.generated.length === 0) {
      await supabaseAdmin
        .from('jobs')
        .update({
          status: 'failed',
          freepik_status: 'COMPLETED',
          error: `No output from ${step}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return NextResponse.json({ received: true, status: 'no_output', step })
    }

    // Process based on step
    let result: { success: boolean; error?: string; outputCount?: number }

    switch (step) {
      case 'image-to-prompt':
        // Step 1 complete → Trigger Step 2
        const templatePrompt = webhook.generated[0]
        console.log('📝 Template prompt extracted:', templatePrompt.substring(0, 100) + '...')
        result = await handleImageToPromptComplete(jobId, templatePrompt)
        break

      case 'improve-prompt':
        // Step 2 complete → Trigger Step 3
        const improvedPrompt = webhook.generated[0]
        console.log('📝 Improved prompt:', improvedPrompt.substring(0, 100) + '...')
        result = await handleImprovePromptComplete(jobId, improvedPrompt)
        break

      case 'seedream-edit':
      default:
        // Step 3 complete → Upload & Finish
        result = await handleSeedreamComplete(
          jobId,
          webhook.generated,
          webhook.has_nsfw || []
        )
        break
    }

    const processingTime = Math.round((Date.now() - startTime) / 1000)

    if (!result.success) {
      await supabaseAdmin
        .from('jobs')
        .update({
          status: 'failed',
          error: result.error || `Failed at ${step}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return NextResponse.json({
        received: true,
        status: 'chain_error',
        step,
        error: result.error,
        processingTime,
      })
    }

    return NextResponse.json({
      received: true,
      status: step === 'seedream-edit' ? 'completed' : 'chain_continued',
      step,
      nextStep: step === 'image-to-prompt' ? 'improve-prompt' : step === 'improve-prompt' ? 'seedream-edit' : null,
      outputCount: result.outputCount,
      processingTime,
    })

  } catch (error) {
    console.error('❌ Freepik webhook error:', error)
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

// Handle GET for webhook verification
export async function GET() {
  return NextResponse.json({ 
    status: 'Freepik Seedream webhook endpoint ready',
    supportedSteps: ['image-to-prompt', 'improve-prompt', 'seedream-edit'],
  })
}
