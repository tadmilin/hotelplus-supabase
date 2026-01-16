import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'

// POST: Count images in multiple folders
export async function POST(req: NextRequest) {
  try {
    const { folderIds } = await req.json()

    if (!Array.isArray(folderIds) || folderIds.length === 0) {
      return NextResponse.json({ error: 'Folder IDs required' }, { status: 400 })
    }

    const drive = getDriveClient()
    if (!drive) {
      return NextResponse.json({ error: 'Google Drive not configured' }, { status: 503 })
    }

    // Count images for each folder
    const counts: Record<string, number> = {}

    for (const folderId of folderIds) {
      try {
        const response = await drive.files.list({
          q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
          fields: 'files(id)',
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          pageSize: 1000,
        })

        counts[folderId] = response.data.files?.length || 0
      } catch (error) {
        console.error(`Error counting images for folder ${folderId}:`, error)
        counts[folderId] = 0
      }
    }

    return NextResponse.json({ counts })
  } catch (error) {
    console.error('Error counting images:', error)
    return NextResponse.json(
      { error: 'Failed to count images' },
      { status: 500 }
    )
  }
}
