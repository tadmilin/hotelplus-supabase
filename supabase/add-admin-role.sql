-- สร้าง table เก็บ admin users (เร็วกว่า JWT parsing)
CREATE TABLE IF NOT EXISTS admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Policy ให้ทุกคนอ่าน admin_users ได้ (ไม่มีข้อมูลอ่อนไหว)
CREATE POLICY "Anyone can read admin users"
ON admin_users FOR SELECT
USING (true);

-- Policy 1: User ธรรมดาเห็นแค่งานของตัวเอง
CREATE POLICY IF NOT EXISTS "Users can view own jobs"
ON jobs FOR SELECT
USING (auth.uid() = user_id);

-- Policy 2: Admin เห็นทุกงาน (เร็วกว่าเดิม)
DROP POLICY IF EXISTS "Admin can read all jobs" ON jobs;
CREATE POLICY "Admin can read all jobs"
ON jobs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = auth.uid()
  )
);

-- คำสั่งตั้ง User เป็น Admin (INSERT แทน UPDATE metadata)
-- แทน 'your-email@example.com' ด้วย email ที่ต้องการตั้งเป็น admin
/*
INSERT INTO admin_users (user_id)
SELECT id FROM auth.users WHERE email = 'your-email@example.com'
ON CONFLICT (user_id) DO NOTHING;
*/

-- ถอน admin (ลบจาก table)
/*
DELETE FROM admin_users 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'email@example.com');
*/

-- ตรวจสอบว่าใครเป็น admin
/*
SELECT u.email, a.created_at
FROM admin_users a
JOIN auth.users u ON u.id = a.user_id;
*/
