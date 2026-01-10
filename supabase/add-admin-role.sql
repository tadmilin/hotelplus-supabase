-- เพิ่ม RLS Policy ให้ Admin สามารถเห็นงานของทุกคนได้
CREATE POLICY "Admin can read all jobs"
ON jobs FOR SELECT
USING (
  auth.uid() IN (
    SELECT id FROM auth.users 
    WHERE raw_user_meta_data->>'is_admin' = 'true'
  )
);

-- คำสั่งตั้ง User เป็น Admin (ให้ run ใน SQL Editor แยก)
-- แทน 'your-email@example.com' ด้วย email ที่ต้องการตั้งเป็น admin
/*
UPDATE auth.users 
SET raw_user_meta_data = raw_user_meta_data || '{"is_admin": true}'::jsonb
WHERE email = 'your-email@example.com';
*/

-- ตรวจสอบว่าใครเป็น admin
/*
SELECT email, raw_user_meta_data->>'is_admin' as is_admin
FROM auth.users
WHERE raw_user_meta_data->>'is_admin' = 'true';
*/
