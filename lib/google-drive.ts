import { google } from 'googleapis'

export function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })

  return google.drive({ version: 'v3', auth })
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
