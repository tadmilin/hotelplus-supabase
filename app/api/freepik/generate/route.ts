import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  imageToPrompt, 
  improvePrompt,
  type SeedreamAspectRatio
} from '@/lib/freepik'

/**
 * Freepik Generate API - Seedream 4.5 Edit with webhook chain
 * 
 * Flow:
 * 1. If template → Image to Prompt API with webhook (optional)
 * 2. Improve Prompt API with webhook (if enabled)
 * 3. Seedream 4.5 Edit API with webhook
 * 4. Webhook → Upload to Cloudinary & complete
 * 
 * This avoids Vercel 60s timeout completely!
 */

interface GenerateRequestBody {
  jobId: string
  imageUrls: string[] // Input images to edit (1-14)
  templateUrl?: string | null // Template for Image to Prompt (optional)
  customPrompt: string
  aspectRatio?: SeedreamAspectRatio
  enableImprovePrompt?: boolean
}

export async function POST(req: NextRequest) {
  let jobId: string | null = null

  try {
    const body: GenerateRequestBody = await req.json()
    jobId = body.jobId

    console.log('📥 Freepik Seedream Generate Request:', {
      jobId,
      imageCount: body.imageUrls?.length || 0,
      hasTemplate: !!body.templateUrl,
      customPrompt: body.customPrompt?.substring(0, 50) + '...',
      aspectRatio: body.aspectRatio,
      enableImprovePrompt: body.enableImprovePrompt,
    })

    // Validation
    if (!jobId || !body.customPrompt) {
      return NextResponse.json(
        { error: 'Missing required fields: jobId and customPrompt' },
        { status: 400 }
      )
    }

    if (!body.imageUrls || body.imageUrls.length === 0) {
      return NextResponse.json(
        { error: 'At least 1 image is required' },
        { status: 400 }
      )
    }

    if (body.imageUrls.length > 5) {
      return NextResponse.json(
        { error: 'Maximum 5 images allowed for Seedream Edit' },
        { status: 400 }
      )
    }

    // Validate image URLs
    const validUrls = body.imageUrls.filter(url => {
      try {
        new URL(url)
        return url.startsWith('http://') || url.startsWith('https://')
      } catch {
        return false
      }
    })

    if (validUrls.length === 0) {
      return NextResponse.json(
        { error: 'No valid image URLs provided' },
        { status: 400 }
      )
    }

    if (validUrls.length !== body.imageUrls.length) {
      console.warn(`⚠️ ${body.imageUrls.length - validUrls.length} invalid URLs filtered out`)
    }

    // Get auth
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Build webhook URL
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!siteUrl) {
      console.error('❌ NEXT_PUBLIC_SITE_URL not configured')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Store generation config in database for webhook to use later
    const generationConfig = {
      customPrompt: body.customPrompt,
      imageUrls: validUrls,
      aspectRatio: body.aspectRatio || 'square_1_1',
      templateUrl: body.templateUrl || null,
      enableImprovePrompt: body.enableImprovePrompt ?? true,
    }

    // Determine starting step based on config
    let startingStep: string
    if (body.templateUrl) {
      startingStep = 'image-to-prompt'
    } else if (body.enableImprovePrompt !== false) {
      startingStep = 'improve-prompt'
    } else {
      startingStep = 'seedream-edit'
    }

    // Update job with config and initial status
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        freepik_status: 'STARTING',
        freepik_step: startingStep,
        metadata: generationConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (updateError) {
      console.error('❌ Failed to update job:', updateError)
      throw new Error('Failed to update job')
    }

    // Start appropriate step
    if (body.templateUrl) {
      // Step 1: Image to Prompt (get style from template)
      console.log('🔍 Step 1: Image to Prompt with webhook...')
      
      const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=image-to-prompt&jobId=${jobId}`
      
      const result = await imageToPrompt(body.templateUrl, webhookUrl)
      const taskId = result.data.task_id
      
      console.log('✅ Image to Prompt task created:', taskId)
      
      await supabase
        .from('jobs')
        .update({
          freepik_task_id: taskId,
          freepik_status: 'IMAGE_TO_PROMPT',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return NextResponse.json({
        success: true,
        step: 'image-to-prompt',
        taskId,
        jobId,
        message: 'Image to Prompt started. Webhook chain will process remaining steps.',
      })
      
    } else if (body.enableImprovePrompt !== false) {
      // Step 2: Improve Prompt directly (no template)
      console.log('✨ Step 1: Improve Prompt with webhook...')
      
      const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=improve-prompt&jobId=${jobId}`
      
      const result = await improvePrompt(body.customPrompt, 'image', webhookUrl)
      const taskId = result.data.task_id
      
      console.log('✅ Improve Prompt task created:', taskId)
      
      await supabase
        .from('jobs')
        .update({
          freepik_task_id: taskId,
          freepik_status: 'IMPROVE_PROMPT',
          freepik_step: 'improve-prompt',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return NextResponse.json({
        success: true,
        step: 'improve-prompt',
        taskId,
        jobId,
        message: 'Improve Prompt started. Webhook chain will process remaining steps.',
      })
      
    } else {
      // Step 3: Seedream directly (no template, no improve)
      console.log('🎨 Step 1: Seedream Edit directly with webhook...')
      
      // Import seedreamEdit here to avoid circular dependency
      const { seedreamEdit, appendNoTextInstructions } = await import('@/lib/freepik')
      
      const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=seedream-edit&jobId=${jobId}`
      const finalPrompt = appendNoTextInstructions(body.customPrompt)
      
      const result = await seedreamEdit({
        prompt: finalPrompt,
        referenceImages: validUrls,
        webhookUrl,
        aspectRatio: body.aspectRatio as SeedreamAspectRatio,
      })
      
      const taskId = result.data.task_id
      
      console.log('✅ Seedream task created:', taskId)
      
      await supabase
        .from('jobs')
        .update({
          freepik_task_id: taskId,
          freepik_status: 'SEEDREAM_GENERATING',
          freepik_step: 'seedream-edit',
          prompt: finalPrompt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return NextResponse.json({
        success: true,
        step: 'seedream-edit',
        taskId,
        jobId,
        message: 'Seedream Edit started. Webhook will complete the job.',
      })
    }

  } catch (error) {
    console.error('❌ Freepik generate error:', error)

    // Update job as failed
    if (jobId) {
      try {
        const supabase = await createClient()
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            freepik_status: 'FAILED',
            error: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      } catch (dbError) {
        console.error('❌ Failed to update job status:', dbError)
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
