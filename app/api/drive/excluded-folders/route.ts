import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: ดึง excluded folders ของ user
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: excludedFolders, error } = await supabase
      .from('excluded_folders')
      .select('*')
      .eq('user_id', user.id)

    if (error) {
      console.error('Error fetching excluded folders:', error)
      return NextResponse.json({ error: 'Failed to fetch excluded folders' }, { status: 500 })
    }

    return NextResponse.json({ folders: excludedFolders || [] })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: เพิ่มโฟลเดอร์ที่ต้องการซ่อน
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { folderId, folderName, driveId } = await req.json()

    if (!folderId || !folderName || !driveId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check if already excluded
    const { data: existing } = await supabase
      .from('excluded_folders')
      .select('id')
      .eq('user_id', user.id)
      .eq('folder_id', folderId)
      .single()

    if (existing) {
      return NextResponse.json({ message: 'Folder already excluded' }, { status: 200 })
    }

    // Add to excluded list
    const { error: insertError } = await supabase
      .from('excluded_folders')
      .insert({
        user_id: user.id,
        user_email: user.email!,
        folder_id: folderId,
        folder_name: folderName,
        drive_id: driveId
      })

    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to exclude folder' }, { status: 500 })
    }

    console.log(`✅ Excluded folder: ${folderName} (${folderId})`)

    return NextResponse.json({ success: true, message: 'Folder excluded successfully' })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: ลบออกจาก excluded list (แสดงโฟลเดอร์กลับมา)
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { folderId } = await req.json()

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID required' }, { status: 400 })
    }

    const { error: deleteError } = await supabase
      .from('excluded_folders')
      .delete()
      .eq('user_id', user.id)
      .eq('folder_id', folderId)

    if (deleteError) {
      console.error('Delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to restore folder' }, { status: 500 })
    }

    console.log(`✅ Restored folder: ${folderId}`)

    return NextResponse.json({ success: true, message: 'Folder restored successfully' })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
