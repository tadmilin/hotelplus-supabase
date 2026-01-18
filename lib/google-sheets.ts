import { google } from 'googleapis'

export function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!clientEmail || !privateKey) {
    console.warn('⚠️ Google Sheets credentials missing.')
    return null
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ],
    })

    return google.sheets({ version: 'v4', auth })
  } catch (error) {
    console.error('❌ Failed to initialize Google Sheets client:', error)
    return null
  }
}

export interface JobExportData {
  id: string
  user_name: string
  user_email: string
  job_type: string
  status: string
  prompt?: string
  template_type?: string
  output_size?: string
  image_count: number
  output_count: number
  created_at: string
  completed_at?: string
  duration_minutes?: number
  replicate_id?: string
  error?: string
}
