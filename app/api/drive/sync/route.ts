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
    // Try Shared Drives first
    console.log('🔍 Fetching Shared Drives...')
    const response = await drive.drives.list({ pageSize: 100 })
    let drives = response.data.drives || []
    console.log(`✅ Found ${drives.length} Shared Drives`)

    // If no Shared Drives, check for shared folders in My Drive
    if (drives.length === 0) {
      console.log('⚠️ No Shared Drives found. Checking for shared folders...')
      
      // Try to list files that are shared with the service account
      const sharedResponse = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and sharedWithMe=true and trashed=false",
        pageSize: 100,
        fields: 'files(id, name, owners)',
        supportsAllDrives: true
      })
      
      console.log(`📁 Found ${sharedResponse.data.files?.length || 0} shared folders`)
      
      // Convert shared folders to drive format
      if (sharedResponse.data.files && sharedResponse.data.files.length > 0) {
        drives = sharedResponse.data.files.map(folder => ({
          id: folder.id!,
          name: folder.name!
        }))
      }
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

    // Clear old drives
    await supabaseAdmin
      .from('google_drives')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    // Insert new drives
    const driveData = drives.map(d => ({
      drive_id: d.id!,
      drive_name: d.name!,
      synced_at: new Date().toISOString()
    }))

    const { error: insertError } = await supabaseAdmin
      .from('google_drives')
      .insert(driveData)

    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to sync drives' }, { status: 500 })
    }

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
