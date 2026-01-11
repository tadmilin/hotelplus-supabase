-- ==========================================
-- SQL สำหรับแก้ปัญหา Dashboard โหลดช้า
-- ==========================================

-- 1. เพิ่ม Composite Index สำหรับ User Query
--    (ช่วยให้ query WHERE user_id + ORDER BY created_at เร็วขึ้นมาก)
CREATE INDEX IF NOT EXISTS idx_jobs_user_created 
ON public.jobs(user_id, created_at DESC);

-- 2. ลบ Policies เก่า
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can delete own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users view own or admin view all" ON public.jobs;
DROP POLICY IF EXISTS "Users update own or admin update all" ON public.jobs;
DROP POLICY IF EXISTS "Users delete own or admin delete all" ON public.jobs;

-- 3. สร้าง Policies ใหม่ที่รองรับ Admin
--    Admin: เช็คจาก raw_user_meta_data->>'is_admin'
--    User ธรรมดา: เช็ค user_id

-- Policy: ดูงาน (User ดูของตัวเอง, Admin ดูทุกงาน)
CREATE POLICY "Users view own or admin view all"
ON public.jobs FOR SELECT
USING (
  auth.uid() = user_id 
  OR 
  (auth.jwt()->>'is_admin')::boolean = true
);

-- Policy: แก้ไขงาน (User แก้ของตัวเอง, Admin แก้ทุกงาน)
CREATE POLICY "Users update own or admin update all"
ON public.jobs FOR UPDATE
USING (
  auth.uid() = user_id 
  OR 
  (auth.jwt()->>'is_admin')::boolean = true
);

-- Policy: ลบงาน (User ลบของตัวเอง, Admin ลบทุกงาน)
CREATE POLICY "Users delete own or admin delete all"
ON public.jobs FOR DELETE
USING (
  auth.uid() = user_id 
  OR 
  (auth.jwt()->>'is_admin')::boolean = true
);

-- 4. อัพเดท Statistics สำหรับ Query Planner
ANALYZE public.jobs;

-- 5. ทดสอบว่า Index ทำงาน (เปลี่ยน 'xxx' เป็น user_id จริง)
-- EXPLAIN ANALYZE SELECT * FROM jobs WHERE user_id = 'xxx' ORDER BY created_at DESC LIMIT 50;
-- ควรเห็น "Index Scan using idx_jobs_user_created"
