import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'
import { uploadBase64ToCloudinary } from '@/lib/cloudinary'

export async function POST(req: NextRequest) {
  try {
    const { fileId, fileName } = await req.json()

    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 })
    }

    const drive = getDriveClient()

    if (!drive) {
      return NextResponse.json({ error: 'Google Drive not configured' }, { status: 503 })
    }

    // Download file from Drive
    const response = await drive.files.get(
      {
        fileId: fileId,
        alt: 'media',
      },
      { responseType: 'arraybuffer' }
    )

    const buffer = Buffer.from(response.data as ArrayBuffer)
    const base64String = `data:image/jpeg;base64,${buffer.toString('base64')}`
    
    // Upload to Cloudinary
    const cloudinaryUrl = await uploadBase64ToCloudinary(base64String, 'hotelplus-v2')

    return NextResponse.json({ url: cloudinaryUrl })
  } catch (error) {
    console.error('Error downloading and uploading:', error)
    return NextResponse.json(
      { error: 'Failed to download and upload file' },
      { status: 500 }
    )
  }
}
