import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

export async function POST(req: NextRequest) {
  try {
    const webhook = await req.json()
    
    console.log('📨 Webhook received:', {
      id: webhook.id,
      status: webhook.status,
      hasOutput: !!webhook.output,
    })

    const replicateId = webhook.id
    const status = webhook.status
    const output = webhook.output
    const error = webhook.error

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

    if (!jobs || jobs.length === 0) {
      console.error('❌ No job found with replicate_id:', replicateId)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobs[0]

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
        if (output.output) {
          outputUrls = Array.isArray(output.output) ? output.output : [output.output]
        } else if (output.images) {
          outputUrls = Array.isArray(output.images) ? output.images : [output.images]
        }
      }

      console.log('✅ Job succeeded:', {
        jobId: job.id,
        outputCount: outputUrls.length,
      })

      // Update job with output URLs
      const { error: updateError } = await supabaseAdmin
        .from('jobs')
        .update({
          status: 'completed',
          output_urls: outputUrls,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      if (updateError) {
        console.error('❌ Error updating job:', updateError)
        return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
      }

      console.log('✅ Job updated successfully')

      // Auto-upscale x2 for non-upscale jobs
      if (job.job_type !== 'upscale' && outputUrls.length > 0) {
        console.log('🔍 Starting auto-upscale x2 for job:', job.id)
        
        try {
          // Create upscale jobs for each output
          for (const outputUrl of outputUrls) {
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
                image_urls: [outputUrl],
                output_urls: [],
              })
              .select()
              .single()

            if (upscaleJob) {
              // Call upscale API
              await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/replicate/upscale`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: upscaleJob.id,
                  imageUrl: outputUrl,
                  scale: 2,
                }),
              })
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
      console.log('⏳ Job still processing:', {
        jobId: job.id,
        status: status,
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
export async function GET(req: NextRequest) {
  return NextResponse.json({ 
    status: 'ok',
    message: 'Webhook endpoint is active',
    timestamp: new Date().toISOString(),
  })
}
