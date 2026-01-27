import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  imageToPrompt, 
  improvePrompt,
  type FreepikMysticModel,
  type FreepikResolution,
  type FreepikAspectRatio
} from '@/lib/freepik'

/**
 * Freepik Generate API - Uses webhook chain instead of polling
 * 
 * Flow:
 * 1. If template → Image to Prompt API with webhook
 * 2. Webhook → Improve Prompt API with webhook
 * 3. Webhook → Mystic Generate API with webhook
 * 4. Webhook → Upload to Cloudinary & complete
 * 
 * This avoids Vercel 60s timeout completely!
 */

interface GenerateRequestBody {
  jobId: string
  templateUrl?: string // Template image for style reference
  customPrompt: string // User's custom prompt (edits)
  model?: FreepikMysticModel
  resolution?: FreepikResolution
  aspectRatio?: FreepikAspectRatio
  useStyleReference?: boolean // Use template as style_reference
}

export async function POST(req: NextRequest) {
  let jobId: string | null = null

  try {
    const body: GenerateRequestBody = await req.json()
    jobId = body.jobId

    console.log('📥 Freepik Generate Request:', {
      jobId,
      hasTemplate: !!body.templateUrl,
      customPrompt: body.customPrompt?.substring(0, 50) + '...',
      model: body.model,
      resolution: body.resolution,
    })

    // Validation
    if (!jobId || !body.customPrompt) {
      return NextResponse.json(
        { error: 'Missing required fields: jobId and customPrompt' },
        { status: 400 }
      )
    }

    // Get auth
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Build webhook URL with step parameter
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
      model: body.model || 'mystic',
      resolution: body.resolution || '2k',
      aspectRatio: body.aspectRatio || 'square_1_1',
      useStyleReference: body.useStyleReference ?? true,
      templateUrl: body.templateUrl || null,
    }

    // Update job with config and initial status
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        freepik_status: 'STARTING',
        freepik_step: body.templateUrl ? 'image-to-prompt' : 'improve-prompt',
        metadata: generationConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (updateError) {
      console.error('❌ Failed to update job:', updateError)
      throw new Error('Failed to update job')
    }

    // Determine starting point based on whether template is provided
    if (body.templateUrl) {
      // Step 1: Start with Image to Prompt (with webhook)
      console.log('🔍 Step 1: Image to Prompt with webhook...')
      
      const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=image-to-prompt&jobId=${jobId}`
      
      const result = await imageToPrompt(body.templateUrl, webhookUrl)
      const taskId = result.data.task_id
      
      console.log('✅ Image to Prompt task created:', taskId)
      
      // Update job with task ID
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
      
    } else {
      // No template: Start directly with Improve Prompt
      console.log('✨ Step 1 (no template): Improve Prompt with webhook...')
      
      const webhookUrl = `${siteUrl}/api/webhooks/freepik?step=improve-prompt&jobId=${jobId}`
      
      const result = await improvePrompt(body.customPrompt, 'image', webhookUrl)
      const taskId = result.data.task_id
      
      console.log('✅ Improve Prompt task created:', taskId)
      
      // Update job with task ID
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
