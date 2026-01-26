import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveClient } from '@/lib/google-drive'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// POST: Trigger sync from Google API to database (Authenticated users)
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Allow authenticated users to sync
    // Sync only updates the drive list (read-only operation from Google)
    
    const drive = getDriveClient()
    if (!drive) {
      return NextResponse.json({ error: 'Google Drive not configured' }, { status: 500 })
    }

    // Fetch drives from Google
    // 🚀 Pagination loop - ดึง Shared Drives ทั้งหมด
    console.log('🔍 Fetching Shared Drives...')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let drives: any[] = []
    let nextPageToken: string | undefined = undefined

    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await drive.drives.list({ 
        pageSize: 100,
        pageToken: nextPageToken,
        fields: 'drives(id, name), nextPageToken'
      })
      drives.push(...(response.data.drives || []))
      nextPageToken = response.data.nextPageToken || undefined
      console.log(`📁 Fetched ${response.data.drives?.length || 0} drives, total: ${drives.length}`)
    } while (nextPageToken)

    console.log(`✅ Found ${drives.length} Shared Drives`)

    // If no Shared Drives, check for shared folders in My Drive
    if (drives.length === 0) {
      console.log('⚠️ No Shared Drives found. Checking for shared folders...')
      
      // 🚀 Pagination loop สำหรับ shared folders ด้วย
      nextPageToken = undefined
      do {
        const sharedResponse = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.folder' and sharedWithMe=true and trashed=false",
          pageSize: 1000, // 🚀 เพิ่มจาก 100
          fields: 'files(id, name, owners), nextPageToken',
          supportsAllDrives: true,
          pageToken: nextPageToken,
        })
        
        console.log(`📁 Found ${sharedResponse.data.files?.length || 0} shared folders (page)`)
        
        // Convert shared folders to drive format
        if (sharedResponse.data.files && sharedResponse.data.files.length > 0) {
          drives.push(...sharedResponse.data.files.map(folder => ({
            id: folder.id!,
            name: folder.name!
          })))
        }
        nextPageToken = sharedResponse.data.nextPageToken || undefined
      } while (nextPageToken)
      
      console.log(`📁 Total shared folders: ${drives.length}`)
    }

    if (drives.length === 0) {
      return NextResponse.json({ 
        error: 'No drives or folders accessible to Service Account',
        hint: 'Please add Service Account to Shared Drives or share folders with it',
        serviceAccount: 'ai-backend@testapi-480011.iam.gserviceaccount.com'
      }, { status: 404 })
    }

    // Use Service Role client for admin operations
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ✅ แทนที่จะลบ google_drives ทั้งหมด - ให้ใช้ UPSERT
    // เพื่อให้ user อื่นๆ ที่ยังใช้ drives เก่าไม่เจอปัญหา
    
    const driveData = drives.map(d => ({
      drive_id: d.id!,
      drive_name: d.name!,
      synced_at: new Date().toISOString()
    }))

    // UPSERT drives (update if exists, insert if new)
    const { error: upsertError } = await supabaseAdmin
      .from('google_drives')
      .upsert(driveData, { 
        onConflict: 'drive_id',
        ignoreDuplicates: false 
      })

    if (upsertError) {
      console.error('Upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to sync drives' }, { status: 500 })
    }

    console.log(`✅ Synced ${drives.length} drives to google_drives table`)

    return NextResponse.json({ 
      success: true, 
      count: drives.length,
      drives: driveData 
    })
  } catch (error) {
    console.error('Sync error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ 
      error: 'Sync failed', 
      details: errorMessage 
    }, { status: 500 })
  }
}
