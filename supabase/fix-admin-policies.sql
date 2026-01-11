-- แก้ไข: Admin ไม่เห็นงานของคนอื่น
-- ปัญหา: JWT token ไม่มี is_admin claim
-- วิธีแก้: เช็คจาก auth.users.raw_user_meta_data แทน

-- ลบ policies ที่ใช้ JWT (ไม่ทำงาน)
DROP POLICY IF EXISTS "Users view own or admin view all" ON public.jobs;
DROP POLICY IF EXISTS "Users update own or admin update all" ON public.jobs;
DROP POLICY IF EXISTS "Users delete own or admin delete all" ON public.jobs;

-- สร้าง policies ใหม่ที่เช็คจาก raw_user_meta_data
-- Policy: ดูงาน
CREATE POLICY "Users view own or admin view all"
ON public.jobs FOR SELECT
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND (raw_user_meta_data->>'is_admin')::boolean = true
  )
);

-- Policy: แก้ไขงาน
CREATE POLICY "Users update own or admin update all"
ON public.jobs FOR UPDATE
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND (raw_user_meta_data->>'is_admin')::boolean = true
  )
);

-- Policy: ลบงาน
CREATE POLICY "Users delete own or admin delete all"
ON public.jobs FOR DELETE
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND (raw_user_meta_data->>'is_admin')::boolean = true
  )
);
