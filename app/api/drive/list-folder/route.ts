import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'

export async function POST(req: NextRequest) {
  try {
    const { folderId } = await req.json()

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID required' }, { status: 400 })
    }

    const drive = getDriveClient()

    if (!drive) {
       return NextResponse.json({ error: 'Google Drive not configured' }, { status: 503 })
    }

    // List images in folder (with pagination support)
    const response = await drive.files.list({
      q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
      fields: 'files(id, name, mimeType, thumbnailLink, webContentLink), nextPageToken',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 1000, // 🚀 MAX ของ Drive API (1000 รูป/ครั้ง)
      orderBy: 'createdTime desc',
    })

    const files = response.data.files || []
    const nextPageToken = response.data.nextPageToken

    const images = files.map((file: any) => ({
      id: file.id!,
      name: file.name!,
      thumbnailUrl: file.thumbnailLink || '',
      url: file.webContentLink || '',
    }))

    return NextResponse.json({ 
      images,
      nextPageToken, // สำหรับ pagination ในอนาคต
      total: images.length
    })
  } catch (error) {
    console.error('Error listing folder:', error)
    return NextResponse.json(
      { error: 'Failed to list folder contents' },
      { status: 500 }
    )
  }
}
