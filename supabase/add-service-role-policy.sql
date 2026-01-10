-- ⚠️ แก้ปัญหา Service Role ไม่สามารถ Update Jobs ได้
-- Run SQL นี้ใน Supabase SQL Editor

-- ลบ policies เก่าที่ไม่ทำงาน
DROP POLICY IF EXISTS "Service role can update all jobs" ON public.jobs;
DROP POLICY IF EXISTS "Service role can insert jobs" ON public.jobs;

-- วิธีที่ถูกต้อง: ใช้ authenticated() แทน auth.jwt()
-- Service role key จะถูกมองว่า authenticated แต่ไม่มี uid

-- Allow all authenticated updates (including service_role)
CREATE POLICY "Allow authenticated to update jobs"
  ON public.jobs
  FOR UPDATE
  TO authenticated
  USING (
    -- Either user owns the job OR it's service_role
    auth.uid() = user_id OR auth.role() = 'service_role'
  );

-- Allow all authenticated inserts (for auto-upscale)
CREATE POLICY "Allow authenticated to insert jobs"  
  ON public.jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Either user is creating their own OR it's service_role
    auth.uid() = user_id OR auth.role() = 'service_role'
  );

-- ✅ Done! Webhook จะอัพเดท jobs ได้แล้ว
