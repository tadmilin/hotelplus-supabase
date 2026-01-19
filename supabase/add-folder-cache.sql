-- ==========================================
-- 📦 FOLDER CACHE TABLE
-- ==========================================
-- ใช้ cache รายการรูปในโฟลเดอร์ เพื่อไม่ต้องเรียก Drive API ทุกครั้ง
-- อัพเดตทุก 1 ชั่วโมง หรือเมื่อกด Refresh

CREATE TABLE IF NOT EXISTS folder_cache (
  id BIGSERIAL PRIMARY KEY,
  folder_id TEXT NOT NULL,
  folder_name TEXT,
  images JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{id, name, thumbnailUrl, url}]
  image_count INTEGER DEFAULT 0,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour'),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INTEGER DEFAULT 0,
  UNIQUE(folder_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_folder_cache_folder_id ON folder_cache(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_cache_expires_at ON folder_cache(expires_at);

-- Auto-cleanup expired cache (runs daily)
CREATE OR REPLACE FUNCTION cleanup_expired_folder_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM folder_cache 
  WHERE expires_at < NOW() 
    AND last_accessed_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- ✅ DONE!
-- ==========================================
