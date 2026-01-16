import { NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'
import { createClient } from '@/lib/supabase/server'
import { drive_v3 } from 'googleapis'

export async function GET() {
  try {
    const drive = getDriveClient()
    
    // If drive is not configured, return empty list instead of crashing
    if (!drive) {
      return NextResponse.json({ drives: [] })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    let drivesToLoad: Array<{ driveId: string; driveName: string }> = []
    
    if (user) {
      // Try to get user's selected drives from database
      const { data: userDrives } = await supabase
        .from('user_drive_access')
        .select(`
          drive_id,
          google_drives (
            drive_id,
            drive_name
          )
        `)
        .eq('user_id', user.id)
      
      if (userDrives && userDrives.length > 0) {
        // User has selected drives - use them (FAST!)
        console.log(`✅ Loading ${userDrives.length} selected drives for user ${user.email}`)
        drivesToLoad = userDrives.map((item) => ({
          driveId: (item as unknown as { google_drives: { drive_id: string } }).google_drives.drive_id,
          driveName: (item as unknown as { google_drives: { drive_name: string } }).google_drives.drive_name
        }))
      } else {
        // No selection yet - show all available drives from google_drives table
        console.log(`ℹ️ No drive selection for user ${user.email}, showing all synced drives`)
        const { data: allDrives } = await supabase
          .from('google_drives')
          .select('drive_id, drive_name')
          .order('drive_name')
        
        drivesToLoad = (allDrives || []).map(d => ({
          driveId: d.drive_id,
          driveName: d.drive_name
        }))
      }
    } else {
      // Not logged in - show all synced drives
      const { data: allDrives } = await supabase
        .from('google_drives')
        .select('drive_id, drive_name')
        .order('drive_name')
      
      drivesToLoad = (allDrives || []).map(d => ({
        driveId: d.drive_id,
        driveName: d.drive_name
      }))
    }
    
    // For each drive, get folder structure from Google
    const driveData = []
    
    for (const driveItem of drivesToLoad) {
      const folders = await getFolderStructure(drive, driveItem.driveId)
      driveData.push({
        driveId: driveItem.driveId,
        driveName: driveItem.driveName,
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

type FolderStructure = { id: string; name: string; children: FolderStructure[] }

async function getFolderStructure(drive: drive_v3.Drive, driveId: string, parentId?: string): Promise<FolderStructure[]> {
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
