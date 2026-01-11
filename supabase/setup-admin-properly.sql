-- วิธีแก้ถาวร: สร้างตาราง admin list และใช้ policy ที่ทำงานได้
-- ==========================================

-- 1. สร้างตาราง admin_users (ถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ปิด RLS สำหรับตาราง admin_users (ให้ policy อื่นอ่านได้)
ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;

-- 3. เพิ่ม admin users (เปลี่ยน email ตามต้องการ)
-- ค้นหา user_id จาก email และเพิ่มเข้า admin_users
INSERT INTO public.admin_users (user_id)
SELECT id FROM auth.users 
WHERE email IN (
  'admin@example.com',  -- เปลี่ยนเป็น email admin จริง
  'tad2@example.com'    -- เพิ่มได้หลาย email
)
ON CONFLICT (user_id) DO NOTHING;

-- 4. ลบ policies เก่า
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can delete own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users view own or admin view all" ON public.jobs;
DROP POLICY IF EXISTS "Users update own or admin update all" ON public.jobs;
DROP POLICY IF EXISTS "Users delete own or admin delete all" ON public.jobs;

-- 5. สร้าง policies ใหม่ที่ทำงานได้
-- Policy: ดูงาน (User ดูของตัวเอง, Admin ดูทุกงาน)
CREATE POLICY "Users view own or admin view all"
ON public.jobs FOR SELECT
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = auth.uid()
  )
);

-- Policy: แก้ไขงาน (User แก้ของตัวเอง, Admin แก้ทุกงาน)
CREATE POLICY "Users update own or admin update all"
ON public.jobs FOR UPDATE
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = auth.uid()
  )
);

-- Policy: ลบงาน (User ลบของตัวเอง, Admin ลบทุกงาน)
CREATE POLICY "Users delete own or admin delete all"
ON public.jobs FOR DELETE
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = auth.uid()
  )
);

-- 6. เสร็จแล้ว! ทดสอบโดยรัน query นี้แยกต่างหาก:
-- SELECT u.email, au.user_id IS NOT NULL as is_admin
-- FROM auth.users u
-- LEFT JOIN public.admin_users au ON u.id = au.user_id
-- WHERE u.email LIKE '%admin%' OR u.email LIKE '%tad%';
