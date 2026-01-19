import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'

export async function POST(req: NextRequest) {
  try {
    const { driveId, folderId } = await req.json()

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID required' }, { status: 400 })
    }

    const drive = getDriveClient()

    if (!drive) {
      return NextResponse.json({ error: 'Google Drive not configured' }, { status: 503 })
    }

    // Check if this is a Shared Drive or regular folder
    const isSharedDrive = driveId && driveId !== 'my-drive' && !driveId.startsWith('1')
    
    const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const listOptions: {
      q: string
      fields: string
      pageSize: number
      supportsAllDrives: boolean
      corpora?: string
      driveId?: string
      includeItemsFromAllDrives?: boolean
    } = {
      q: query,
      fields: 'files(id, name)',
      pageSize: 100,
      supportsAllDrives: true,
    }

    if (isSharedDrive) {
      listOptions.corpora = 'drive'
      listOptions.driveId = driveId
      listOptions.includeItemsFromAllDrives = true
    }

    const response = await drive.files.list(listOptions)
    const folders = (response.data.files || []).map(folder => ({
      id: folder.id!,
      name: folder.name!,
      children: [], // ⚡ Lazy - ไม่ดึง children ลึกลงไป
    }))

    return NextResponse.json({ folders })
  } catch (error) {
    console.error('Error expanding folder:', error)
    return NextResponse.json(
      { error: 'Failed to expand folder' },
      { status: 500 }
    )
  }
}
