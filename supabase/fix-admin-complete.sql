-- แก้ไข Admin policies ให้ทำงานได้ถูกต้อง
-- ==========================================

-- 1. ลบ policies เก่าทั้งหมดของ jobs (ทำความสะอาด)
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can delete own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users view own or admin view all" ON public.jobs;
DROP POLICY IF EXISTS "Users update own or admin update all" ON public.jobs;
DROP POLICY IF EXISTS "Users delete own or admin delete all" ON public.jobs;
DROP POLICY IF EXISTS "Admin can read all jobs" ON public.jobs;
DROP POLICY IF EXISTS "view_jobs_policy" ON public.jobs;
DROP POLICY IF EXISTS "jobs_select_policy" ON public.jobs;

-- 2. สร้างตาราง admin_users (ถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ปิด RLS ของ admin_users เพื่อให้ policy อื่นอ่านได้
ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;

-- 4. เพิ่ม admin users (2 คน)
INSERT INTO public.admin_users (user_id)
SELECT id FROM auth.users WHERE email = 'tadeyes1@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.admin_users (user_id)
SELECT id FROM auth.users WHERE email = 'datapoints@hotelplus.asia'
ON CONFLICT (user_id) DO NOTHING;

-- 5. สร้าง policies ใหม่ (แยกตาม action)

-- SELECT: User ดูของตัวเอง หรือ Admin ดูทุกงาน
CREATE POLICY "jobs_select_policy"
ON public.jobs FOR SELECT
USING (
  user_id = auth.uid()
  OR
  auth.uid() IN (SELECT user_id FROM public.admin_users)
);

-- INSERT: User สร้างได้แค่ของตัวเอง
CREATE POLICY "jobs_insert_policy"
ON public.jobs FOR INSERT
WITH CHECK (user_id = auth.uid());

-- UPDATE: User แก้ของตัวเอง หรือ Admin แก้ทุกงาน
CREATE POLICY "jobs_update_policy"
ON public.jobs FOR UPDATE
USING (
  user_id = auth.uid()
  OR
  auth.uid() IN (SELECT user_id FROM public.admin_users)
);

-- DELETE: User ลบของตัวเอง หรือ Admin ลบทุกงาน
CREATE POLICY "jobs_delete_policy"
ON public.jobs FOR DELETE
USING (
  user_id = auth.uid()
  OR
  auth.uid() IN (SELECT user_id FROM public.admin_users)
);

-- 6. ตรวจสอบผลลัพธ์
SELECT 'Admin users:' as info;
SELECT user_id, created_at FROM public.admin_users;

SELECT 'Policies for jobs table:' as info;
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'jobs';

SELECT 'Done! Please logout and login again.' as message;
