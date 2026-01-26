-- 🚀 Cache สำหรับโครงสร้างโฟลเดอร์ของแต่ละ Drive
-- ช่วยให้โหลดเร็วมากขึ้นในครั้งถัดไป (TTL 30 นาที)

CREATE TABLE IF NOT EXISTS drive_folder_structure_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id TEXT NOT NULL UNIQUE,
  folder_structure JSONB NOT NULL,
  folder_count INTEGER DEFAULT 0,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index สำหรับ lookup
CREATE INDEX IF NOT EXISTS idx_folder_structure_cache_drive_id ON drive_folder_structure_cache(drive_id);
CREATE INDEX IF NOT EXISTS idx_folder_structure_cache_expires ON drive_folder_structure_cache(expires_at);

-- RLS Policy
ALTER TABLE drive_folder_structure_cache ENABLE ROW LEVEL SECURITY;

-- Service role สามารถ CRUD ได้ทั้งหมด
CREATE POLICY "Service role can manage folder structure cache"
  ON drive_folder_structure_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comment
COMMENT ON TABLE drive_folder_structure_cache IS 'Cache โครงสร้างโฟลเดอร์ของ Drive เพื่อลดเวลาโหลด';
