import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveClient } from '@/lib/google-drive'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// POST: Trigger sync from Google API to database (Admin only)
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin (optional - remove if all users can sync)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const drive = getDriveClient()
    if (!drive) {
      return NextResponse.json({ error: 'Google Drive not configured' }, { status: 500 })
    }

    // Fetch drives from Google
    const response = await drive.drives.list({ pageSize: 100 })
    const drives = response.data.drives || []

    if (drives.length === 0) {
      return NextResponse.json({ error: 'No drives found' }, { status: 404 })
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
