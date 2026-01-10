import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'

export async function GET(req: NextRequest) {
  try {
    const drive = getDriveClient()
    
    // If drive is not configured, return empty list instead of crashing
    if (!drive) {
      return NextResponse.json({ drives: [] })
    }
    
    // List all shared drives
    const response = await drive.drives.list({
      pageSize: 100,
    })

    const drives = response.data.drives || []
    
    // For each drive, get folder structure
    const driveData = []
    
    for (const driveItem of drives) {
      const folders = await getFolderStructure(drive, driveItem.id!)
      driveData.push({
        driveId: driveItem.id!,
        driveName: driveItem.name!,
        folders: folders,
      })
    }

    return NextResponse.json({ drives: driveData })
  } catch (error) {
    console.error('Error listing folders:', error)
    return NextResponse.json(
      { error: 'Failed to list folders' },
      { status: 500 }
    )
  }
}

async function getFolderStructure(drive: any, driveId: string, parentId?: string): Promise<any[]> {
  try {
    const query = parentId
      ? `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `mimeType='application/vnd.google-apps.folder' and trashed=false`

    const response = await drive.files.list({
      corpora: 'drive',
      driveId: driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: query,
      fields: 'files(id, name)',
      pageSize: 100,
    })

    const folders = response.data.files || []
    
    const result = []
    for (const folder of folders) {
      const children = await getFolderStructure(drive, driveId, folder.id!)
      result.push({
        id: folder.id!,
        name: folder.name!,
        children: children,
      })
    }

    return result
  } catch (error) {
    console.error('Error getting folder structure:', error)
    return []
  }
}
