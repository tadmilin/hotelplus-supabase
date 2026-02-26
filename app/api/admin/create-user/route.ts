import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

// Supabase Admin client (service_role) — ใช้สร้าง user ได้
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export async function POST(request: NextRequest) {
  try {
    // 1. ตรวจ session ว่า login อยู่หรือไม่
    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'กรุณาเข้าสู่ระบบก่อน' },
        { status: 401 }
      )
    }

    // 2. ตรวจว่าเป็น admin หรือไม่
    const { data: adminRecord } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .single()

    if (!adminRecord) {
      return NextResponse.json(
        { error: 'คุณไม่มีสิทธิ์สร้างบัญชีผู้ใช้' },
        { status: 403 }
      )
    }

    // 3. รับข้อมูลจาก request body
    const { email, password, name } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'กรุณากรอก email และ password' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' },
        { status: 400 }
      )
    }

    // 4. สร้าง user ผ่าน Admin API (bypass sign-up restriction)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // ยืนยัน email อัตโนมัติ
      user_metadata: {
        name: name || email.split('@')[0],
      },
    })

    if (createError) {
      return NextResponse.json(
        { error: createError.message },
        { status: 400 }
      )
    }

    // 5. สร้าง profile ในตาราง profiles
    if (newUser.user) {
      await supabaseAdmin.from('profiles').upsert({
        id: newUser.user.id,
        email: newUser.user.email,
        name: name || email.split('@')[0],
        role: 'user',
      })
    }

    return NextResponse.json({
      success: true,
      message: `สร้างบัญชี ${email} สำเร็จ`,
      user: {
        id: newUser.user?.id,
        email: newUser.user?.email,
        name: name || email.split('@')[0],
      },
    })
  } catch (error) {
    console.error('Create user error:', error)
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการสร้างบัญชี' },
      { status: 500 }
    )
  }
}
