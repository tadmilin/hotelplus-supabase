-- แก้ไข RLS Policy ให้ admin ดูงานของทุกคนได้

-- ลบ policy เดิม
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;

-- สร้าง policy ใหม่: admin ดูทุกงาน, user ธรรมดาดูแค่ของตัวเอง
CREATE POLICY "Users can view jobs"
  ON public.jobs FOR SELECT
  USING (
    auth.uid() = user_id 
    OR 
    EXISTS (
      SELECT 1 FROM public.admin_users 
      WHERE admin_users.user_id = auth.uid()
    )
  );

-- ตรวจสอบว่ามี admin_users table หรือยัง (ถ้าไม่มีให้สร้าง)
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Policy: ทุกคนดูได้ว่าใครเป็น admin
CREATE POLICY "Anyone can view admin users"
  ON public.admin_users FOR SELECT
  USING (true);

COMMENT ON TABLE public.admin_users IS 'Admin users who can view all jobs';
