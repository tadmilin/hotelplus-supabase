-- Create drive_cache table for Cloudinary CDN caching
-- This speeds up Dashboard loading by serving images from Cloudinary instead of Google Drive

CREATE TABLE IF NOT EXISTS public.drive_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_file_id TEXT NOT NULL UNIQUE,
    file_name TEXT,
    cloudinary_url TEXT NOT NULL,
    cloudinary_public_id TEXT,
    file_size_bytes BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    access_count INTEGER DEFAULT 0
);

-- Index for fast lookup by drive_file_id
CREATE INDEX IF NOT EXISTS idx_drive_cache_file_id ON public.drive_cache(drive_file_id);

-- Index for cleanup queries (remove old unused cache)
CREATE INDEX IF NOT EXISTS idx_drive_cache_last_accessed ON public.drive_cache(last_accessed_at);

-- Enable RLS
ALTER TABLE public.drive_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read cache (public CDN URLs)
CREATE POLICY "Anyone can read drive cache"
    ON public.drive_cache
    FOR SELECT
    USING (true);

-- Policy: Service role can insert/update cache
CREATE POLICY "Service role can manage drive cache"
    ON public.drive_cache
    FOR ALL
    USING (auth.role() = 'service_role');

-- Function to update last_accessed_at and increment access_count
CREATE OR REPLACE FUNCTION public.update_drive_cache_access(cache_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.drive_cache
    SET 
        last_accessed_at = NOW(),
        access_count = access_count + 1
    WHERE id = cache_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON TABLE public.drive_cache IS 'Cache Google Drive files to Cloudinary CDN for faster loading';
