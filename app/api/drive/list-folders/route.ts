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
        
        // Filter out null google_drives (invalid references)
        drivesToLoad = userDrives
          .filter((item) => {
            const driveData = (item as unknown as { google_drives: { drive_id: string; drive_name: string } | null }).google_drives
            return driveData !== null
          })
          .map((item) => ({
            driveId: (item as unknown as { google_drives: { drive_id: string } }).google_drives.drive_id,
            driveName: (item as unknown as { google_drives: { drive_name: string } }).google_drives.drive_name
          }))
        
        if (drivesToLoad.length === 0) {
          console.log(`⚠️ User has selections but no valid drives found, showing all synced drives`)
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to list folders', details: errorMessage },
      { status: 500 }
    )
  }
}

type FolderStructure = { id: string; name: string; children: FolderStructure[] }

async function getFolderStructure(drive: drive_v3.Drive, driveId: string, parentId?: string): Promise<FolderStructure[]> {
  try {
    // Check if this is a Shared Drive or a regular folder
    const isSharedDrive = driveId !== 'my-drive' && !driveId.startsWith('1')
    
    let query: string
    let listOptions: drive_v3.Params$Resource$Files$List
    
    if (isSharedDrive) {
      // Shared Drive: use driveId and corpora
      query = parentId
        ? `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
        : `mimeType='application/vnd.google-apps.folder' and trashed=false`
      
      listOptions = {
        corpora: 'drive',
        driveId: driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        q: query,
        fields: 'files(id, name)',
        pageSize: 100,
      }
    } else {
      // Regular folder: use parent folder as starting point
      const folderId = parentId || driveId
      query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      
      listOptions = {
        q: query,
        fields: 'files(id, name)',
        pageSize: 100,
        supportsAllDrives: true,
      }
    }

    const response = await drive.files.list(listOptions)
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
    console.error(`Error getting folder structure for ${driveId}:`, error)
    return []
  }
}
