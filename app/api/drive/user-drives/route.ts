import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: ดึง drives ที่ user เลือกไว้
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's selected drives with full drive info
    const { data: userDrives, error } = await supabase
      .from('user_drive_access')
      .select(`
        drive_id,
        google_drives (
          drive_id,
          drive_name,
          synced_at
        )
      `)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error fetching user drives:', error)
      return NextResponse.json({ error: 'Failed to fetch drives' }, { status: 500 })
    }

    // Flatten the data
    const drives = (userDrives || []).map((item) => ({
      drive_id: (item as unknown as { google_drives: { drive_id: string } }).google_drives.drive_id,
      drive_name: (item as unknown as { google_drives: { drive_name: string } }).google_drives.drive_name,
      synced_at: (item as unknown as { google_drives: { synced_at: string } }).google_drives.synced_at
    }))

    return NextResponse.json({ drives })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: บันทึก drives ที่ user เลือก
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { driveIds } = await req.json()

    if (!Array.isArray(driveIds)) {
      return NextResponse.json({ error: 'Invalid drive IDs' }, { status: 400 })
    }

    // Delete old selections
    await supabase
      .from('user_drive_access')
      .delete()
      .eq('user_id', user.id)

    // Insert new selections
    if (driveIds.length > 0) {
      const insertData = driveIds.map(driveId => ({
        user_id: user.id,
        user_email: user.email!,
        drive_id: driveId
      }))

      const { error: insertError } = await supabase
        .from('user_drive_access')
        .insert(insertData)

      if (insertError) {
        console.error('Insert error:', insertError)
        return NextResponse.json({ error: 'Failed to save selections' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, count: driveIds.length })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
