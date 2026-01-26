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
        // 🚀 Pagination loop - นับให้ครบทุกรูป
        let totalCount = 0
        let nextPageToken: string | undefined = undefined

        do {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response: any = await drive.files.list({
            q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
            fields: 'files(id), nextPageToken',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            pageSize: 1000,
            pageToken: nextPageToken,
          })

          totalCount += response.data.files?.length || 0
          nextPageToken = response.data.nextPageToken || undefined
        } while (nextPageToken)

        counts[folderId] = totalCount
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
