import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSheetsClient } from '@/lib/google-sheets'

// POST: Export jobs to Google Sheets
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isAdmin = profile?.role === 'admin'

    const { spreadsheetId, sheetName = 'Jobs Export' } = await req.json()

    if (!spreadsheetId) {
      return NextResponse.json({ error: 'Spreadsheet ID required' }, { status: 400 })
    }

    const sheets = getSheetsClient()
    if (!sheets) {
      return NextResponse.json({ error: 'Google Sheets not configured' }, { status: 500 })
    }

    // Fetch jobs (admin sees all, users see only their own)
    let query = supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })

    if (!isAdmin) {
      query = query.eq('user_id', user.id)
    }

    const { data: jobs, error: jobsError } = await query

    if (jobsError) {
      console.error('Jobs query error:', jobsError)
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ error: 'No jobs to export' }, { status: 400 })
    }

    // Prepare data for sheets
    const headers = [
      'Job ID',
      'User Name',
      'User Email',
      'Job Type',
      'Status',
      'Prompt',
      'Template Type',
      'Output Size',
      'Input Images',
      'Output Images',
      'Created At',
      'Completed At',
      'Duration (min)',
      'Replicate ID',
      'Error'
    ]

    const rows = jobs.map(job => {
      const createdAt = new Date(job.created_at)
      const completedAt = job.completed_at ? new Date(job.completed_at) : null
      const duration = completedAt 
        ? Math.round((completedAt.getTime() - createdAt.getTime()) / 60000) 
        : null

      return [
        job.id,
        job.user_name || '',
        job.user_email || '',
        job.job_type || '',
        job.status || '',
        job.prompt || '',
        job.template_type || '',
        job.output_size || '',
        (job.image_urls || []).length,
        (job.output_urls || []).length,
        createdAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
        completedAt ? completedAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '',
        duration || '',
        job.replicate_id || '',
        job.error || ''
      ]
    })

    // Try to clear and write to sheet
    try {
      // Clear existing data (optional)
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A:Z`
      })

      // Write headers and data
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers, ...rows]
        }
      })

      // Format header row (bold, freeze)
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 },
                    textFormat: {
                      bold: true,
                      foregroundColor: { red: 1, green: 1, blue: 1 }
                    }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            },
            {
              updateSheetProperties: {
                properties: {
                  sheetId: 0,
                  gridProperties: {
                    frozenRowCount: 1
                  }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            }
          ]
        }
      })

      console.log(`✅ Exported ${jobs.length} jobs to Google Sheets`)

      return NextResponse.json({
        success: true,
        count: jobs.length,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
      })
    } catch (sheetsError: unknown) {
      console.error('Google Sheets API error:', sheetsError)
      
      // Check for permission error
      if (sheetsError && typeof sheetsError === 'object' && 'code' in sheetsError && sheetsError.code === 403) {
        return NextResponse.json({
          error: 'Permission denied. Please share the spreadsheet with the service account.',
          serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
        }, { status: 403 })
      }

      throw sheetsError
    }
  } catch (error) {
    console.error('Export error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ 
      error: 'Failed to export to Google Sheets', 
      details: errorMessage 
    }, { status: 500 })
  }
}
