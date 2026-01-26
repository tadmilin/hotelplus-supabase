-- Add drive_type column to google_drives table
-- This allows us to correctly identify Shared Drives vs Shared Folders

ALTER TABLE public.google_drives 
ADD COLUMN IF NOT EXISTS drive_type TEXT DEFAULT 'shared_drive';

-- Add comment
COMMENT ON COLUMN public.google_drives.drive_type IS 'Type of drive: shared_drive or shared_folder';

-- Update index
CREATE INDEX IF NOT EXISTS idx_google_drives_type ON public.google_drives(drive_type);
