import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { drive_v3 } from 'googleapis'

// 🚀 Supabase Admin สำหรับ cache operations
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 🚀 Concurrency limiter - ป้องกัน rate limit
const MAX_CONCURRENT = 10
async function limitConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result)
    })
    executing.push(p as unknown as Promise<void>)

    if (executing.length >= limit) {
      await Promise.race(executing)
      executing.splice(0, executing.findIndex((e) => e === p) + 1)
    }
  }

  await Promise.all(executing)
  return results
}

// 🗑️ DELETE: Clear folder structure cache (force refresh)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const driveId = searchParams.get('driveId')
    
    if (driveId) {
      // ลบ cache เฉพาะ drive
      await supabaseAdmin
        .from('drive_folder_structure_cache')
        .delete()
        .eq('drive_id', driveId)
      console.log(`🗑️ Cleared cache for drive: ${driveId}`)
    } else {
      // ลบ cache ทั้งหมด
      await supabaseAdmin
        .from('drive_folder_structure_cache')
        .delete()
        .neq('drive_id', '') // Delete all
      console.log(`🗑️ Cleared all folder structure cache`)
    }
    
    return NextResponse.json({ success: true, message: 'Cache cleared' })
  } catch (error) {
    console.error('Error clearing cache:', error)
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const drive = getDriveClient()
    
    // If drive is not configured, return empty list instead of crashing
    if (!drive) {
      return NextResponse.json({ drives: [] })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    let drivesToLoad: Array<{ driveId: string; driveName: string; driveType: string }> = []
    
    if (user) {
      // Try to get user's selected drives from database
      const { data: userDrives } = await supabase
        .from('user_drive_access')
        .select(`
          drive_id,
          google_drives (
            drive_id,
            drive_name,
            drive_type
          )
        `)
        .eq('user_id', user.id)
      
      if (userDrives && userDrives.length > 0) {
        // User has selected drives - use them (FAST!)
        console.log(`✅ Loading ${userDrives.length} selected drives for user ${user.email}`)
        
        // Filter out null google_drives (invalid references)
        drivesToLoad = userDrives
          .filter((item) => {
            const driveData = (item as unknown as { google_drives: { drive_id: string; drive_name: string; drive_type: string } | null }).google_drives
            return driveData !== null
          })
          .map((item) => ({
            driveId: (item as unknown as { google_drives: { drive_id: string } }).google_drives.drive_id,
            driveName: (item as unknown as { google_drives: { drive_name: string } }).google_drives.drive_name,
            driveType: (item as unknown as { google_drives: { drive_type: string } }).google_drives.drive_type || 'shared_drive'
          }))
        
        if (drivesToLoad.length === 0) {
          console.log(`⚠️ User has selections but no valid drives found, showing all synced drives`)
          const { data: allDrives } = await supabase
            .from('google_drives')
            .select('drive_id, drive_name, drive_type')
            .order('drive_name')
          
          drivesToLoad = (allDrives || []).map(d => ({
            driveId: d.drive_id,
            driveName: d.drive_name,
            driveType: d.drive_type || 'shared_drive'
          }))
        }
      } else {
        // No selection yet - show all available drives from google_drives table
        console.log(`ℹ️ No drive selection for user ${user.email}, showing all synced drives`)
        const { data: allDrives } = await supabase
          .from('google_drives')
          .select('drive_id, drive_name, drive_type')
          .order('drive_name')
        
        drivesToLoad = (allDrives || []).map(d => ({
          driveId: d.drive_id,
          driveName: d.drive_name,
          driveType: d.drive_type || 'shared_drive'
        }))
      }
    } else {
      // Not logged in - show all synced drives
      const { data: allDrives } = await supabase
        .from('google_drives')
        .select('drive_id, drive_name, drive_type')
        .order('drive_name')
      
      drivesToLoad = (allDrives || []).map(d => ({
        driveId: d.drive_id,
        driveName: d.drive_name,
        driveType: d.drive_type || 'shared_drive'
      }))
    }
    
    // 🚀 OPTIMIZATION: โหลด drives แบบ parallel + cache
    const CACHE_TTL_MINUTES = 30 // cache 30 นาที
    
    const driveData = await Promise.all(
      drivesToLoad.map(async (driveItem) => {
        try {
          // 🚀 Check cache first (wrapped in try-catch for safety)
          const { data: cached, error: cacheError } = await supabaseAdmin
            .from('drive_folder_structure_cache')
            .select('*')
            .eq('drive_id', driveItem.driveId)
            .gt('expires_at', new Date().toISOString())
            .single()

          if (cached && !cacheError) {
            // Cache HIT! 🎉
            console.log(`✅ Cache HIT: ${driveItem.driveName} (${cached.folder_count} folders)`)
            
            // Update access stats (async, don't wait)
            void supabaseAdmin
              .from('drive_folder_structure_cache')
              .update({
                last_accessed_at: new Date().toISOString(),
                access_count: (cached.access_count || 0) + 1
              })
              .eq('drive_id', driveItem.driveId)

            return {
              driveId: driveItem.driveId,
              driveName: driveItem.driveName,
              folders: cached.folder_structure as FolderStructure[],
              cached: true,
            }
          }
        } catch {
          // Cache table might not exist - continue without cache
          console.log(`⚠️ Cache check failed for ${driveItem.driveName}, fetching fresh...`)
        }

        // Cache MISS - fetch from Google Drive
        console.log(`⚠️ Cache MISS: ${driveItem.driveName} (type: ${driveItem.driveType}) - fetching from Google...`)
        const startTime = Date.now()
        const isSharedDrive = driveItem.driveType === 'shared_drive'
        const folders = await getFolderStructure(drive, driveItem.driveId, isSharedDrive)
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        
        // Count total folders (recursive)
        const countFolders = (f: FolderStructure[]): number => {
          return f.reduce((acc, folder) => acc + 1 + countFolders(folder.children), 0)
        }
        const folderCount = countFolders(folders)
        
        console.log(`📁 Fetched ${driveItem.driveName}: ${folderCount} folders in ${duration}s`)

        // 💾 Save to cache (wrapped in try-catch - don't fail if cache table doesn't exist)
        try {
          await supabaseAdmin
            .from('drive_folder_structure_cache')
            .upsert({
              drive_id: driveItem.driveId,
              folder_structure: folders,
              folder_count: folderCount,
              cached_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000).toISOString(),
              last_accessed_at: new Date().toISOString(),
              access_count: 1
            }, { onConflict: 'drive_id' })
          console.log(`💾 Cached: ${driveItem.driveName}`)
        } catch {
          // Cache table might not exist - continue without caching
          console.log(`⚠️ Could not cache ${driveItem.driveName} - table may not exist`)
        }

        return {
          driveId: driveItem.driveId,
          driveName: driveItem.driveName,
          folders: folders,
          cached: false,
        }
      })
    )

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

// 🚀 Helper: ดึง folders ทั้งหมดด้วย pagination
async function listAllFolders(
  drive: drive_v3.Drive,
  listOptions: drive_v3.Params$Resource$Files$List
): Promise<drive_v3.Schema$File[]> {
  const allFolders: drive_v3.Schema$File[] = []
  let nextPageToken: string | undefined = undefined

  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await drive.files.list({
      ...listOptions,
      pageToken: nextPageToken,
      fields: 'files(id, name), nextPageToken', // ✅ เพิ่ม nextPageToken
    })
    
    const folders = response.data.files || []
    allFolders.push(...folders)
    nextPageToken = response.data.nextPageToken || undefined
    
    console.log(`📁 Fetched ${folders.length} folders, total: ${allFolders.length}`)
  } while (nextPageToken)

  return allFolders
}

async function getFolderStructure(
  drive: drive_v3.Drive, 
  driveId: string, 
  isSharedDrive: boolean,
  parentId?: string,
  depth: number = 0
): Promise<FolderStructure[]> {
  // 🚀 เพิ่ม depth limit เป็น 20 ชั้น - กันเหนียว รองรับโครงสร้างลึกมาก
  const MAX_DEPTH = 20
  if (depth >= MAX_DEPTH) {
    console.log(`⚠️ Depth limit reached at ${depth} for ${driveId}`)
    return []
  }

  try {
    // 🔥 FIX: สำหรับ root level ให้ใช้ driveId เป็น parent
    // สำหรับ sub-folder ให้ใช้ parentId
    const effectiveParent = parentId || driveId
    const query = `'${effectiveParent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    
    console.log(`🔍 [Depth ${depth}] Query folders: driveId=${driveId}, parentId=${parentId || 'ROOT'}, isSharedDrive=${isSharedDrive}`)
    console.log(`🔍 Query: ${query}`)
    
    let listOptions: drive_v3.Params$Resource$Files$List
    
    if (isSharedDrive) {
      // Shared Drive: ใช้ corpora='drive' + driveId
      listOptions = {
        corpora: 'drive',
        driveId: driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        q: query,
        pageSize: 1000,
      }
    } else {
      // Regular folder ที่ share มา: ใช้ corpora='user'
      listOptions = {
        q: query,
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }
    }

    // 🚀 ใช้ pagination loop ดึงให้ครบทุกโฟลเดอร์
    const folders = await listAllFolders(drive, listOptions)
    
    console.log(`📁 [Depth ${depth}] Found ${folders.length} folders under parent=${effectiveParent}`)
    if (folders.length > 0) {
      console.log(`📁 Folders: ${folders.map(f => f.name).join(', ')}`)
    }
    
    // ⚡ Recursion ดึง children แบบ parallel + concurrency limit (ป้องกัน rate limit)
    const tasks = folders.map((folder) => async () => {
      const children = await getFolderStructure(drive, driveId, isSharedDrive, folder.id!, depth + 1)
      return {
        id: folder.id!,
        name: folder.name!,
        children: children,
      }
    })
    
    const result = await limitConcurrency(tasks, MAX_CONCURRENT)

    return result
  } catch (error) {
    console.error(`Error getting folder structure for ${driveId}:`, error)
    return []
  }
}
