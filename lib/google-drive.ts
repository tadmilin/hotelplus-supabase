import { google } from 'googleapis'

export function getDriveClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!clientEmail || !privateKey) {
    console.warn('⚠️ Google Drive credentials missing. Drive features will be disabled.')
    return null
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })

    return google.drive({ version: 'v3', auth })
  } catch (error) {
    console.error('❌ Failed to initialize Google Drive client:', error)
    return null
  }
}

export interface DriveFolder {
  id: string
  name: string
  children: DriveFolder[]
}

export interface DriveImage {
  id: string
  name: string
  thumbnailUrl: string
  url: string
}
