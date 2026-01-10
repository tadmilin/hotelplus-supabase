import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'

export async function POST(req: NextRequest) {
  try {
    const { folderId } = await req.json()

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID required' }, { status: 400 })
    }

    const drive = getDriveClient()

    // List images in folder
    const response = await drive.files.list({
      q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
      fields: 'files(id, name, mimeType, thumbnailLink, webContentLink)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 50,
      orderBy: 'createdTime desc',
    })

    const files = response.data.files || []

    const images = files.map((file: any) => ({
      id: file.id!,
      name: file.name!,
      thumbnailUrl: file.thumbnailLink || '',
      url: file.webContentLink || '',
    }))

    return NextResponse.json({ images })
  } catch (error) {
    console.error('Error listing folder:', error)
    return NextResponse.json(
      { error: 'Failed to list folder contents' },
      { status: 500 }
    )
  }
}
