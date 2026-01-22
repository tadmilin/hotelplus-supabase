-- =====================================================
-- job_predictions table - แก้ race condition สำหรับ gpt-with-template
-- ใช้ INSERT แทน UPDATE metadata เพื่อให้ atomic
-- =====================================================

-- สร้างตาราง job_predictions
CREATE TABLE IF NOT EXISTS job_predictions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  prediction_id text NOT NULL,
  urls text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  
  -- ป้องกัน duplicate (ถ้า webhook มาซ้ำ)
  UNIQUE(job_id, prediction_id)
);

-- Index สำหรับ query by job_id
CREATE INDEX IF NOT EXISTS idx_job_predictions_job_id ON job_predictions(job_id);

-- Index สำหรับ cleanup old records
CREATE INDEX IF NOT EXISTS idx_job_predictions_created_at ON job_predictions(created_at);

-- Enable RLS
ALTER TABLE job_predictions ENABLE ROW LEVEL SECURITY;

-- Policy: Service role full access (webhook ใช้ service role)
CREATE POLICY "Service role full access" ON job_predictions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policy: Users can view their own predictions via jobs
CREATE POLICY "Users can view own predictions" ON job_predictions
  FOR SELECT TO authenticated
  USING (
    job_id IN (
      SELECT id FROM jobs WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- Optional: Function สำหรับ auto-cleanup records เก่ากว่า 30 วัน
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_old_job_predictions()
RETURNS void AS $$
BEGIN
  DELETE FROM job_predictions 
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION cleanup_old_job_predictions() TO service_role;

-- =====================================================
-- ตรวจสอบว่าสร้างสำเร็จ
-- =====================================================
SELECT 
  'job_predictions table created successfully' as status,
  (SELECT COUNT(*) FROM job_predictions) as row_count;
