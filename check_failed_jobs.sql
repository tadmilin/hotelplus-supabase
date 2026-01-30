-- Run this in Supabase SQL Editor to find the real error cause

-- 1. ดู jobs ที่ failed ใน 7 วันล่าสุด (จัดกลุ่มตาม error message)
SELECT 
  error,
  COUNT(*) as count,
  job_type
FROM jobs 
WHERE status = 'failed' 
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY error, job_type
ORDER BY count DESC;

-- 2. ดูรายละเอียด 20 jobs ล่าสุดที่ failed
SELECT 
  id,
  job_type,
  status,
  error,
  replicate_id,
  created_at,
  updated_at
FROM jobs 
WHERE status = 'failed' 
ORDER BY created_at DESC
LIMIT 20;

-- 3. ดู jobs ที่ค้าง processing นานเกิน 1 ชั่วโมง (อาจ webhook ไม่ทำงาน)
SELECT 
  id,
  job_type,
  status,
  replicate_id,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at))/60 as minutes_elapsed
FROM jobs 
WHERE status IN ('processing', 'pending')
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
