-- Create tables for Google Drive sync system
-- This enables per-user Drive filtering with centralized sync

-- Table 1: Master list of all available Google Drives (synced from Google API)
CREATE TABLE IF NOT EXISTS public.google_drives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id TEXT UNIQUE NOT NULL,
  drive_name TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table 2: User-specific drive selections (which drives each user wants to see)
CREATE TABLE IF NOT EXISTS public.user_drive_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  drive_id TEXT REFERENCES public.google_drives(drive_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_google_drives_drive_id ON public.google_drives(drive_id);
CREATE INDEX IF NOT EXISTS idx_user_drive_access_user_id ON public.user_drive_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_drive_access_user_email ON public.user_drive_access(user_email);
CREATE INDEX IF NOT EXISTS idx_user_drive_access_drive_id ON public.user_drive_access(drive_id);

-- Enable Row Level Security
ALTER TABLE public.google_drives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_drive_access ENABLE ROW LEVEL SECURITY;

-- google_drives policies: Everyone can read (to select drives)
CREATE POLICY "Anyone can view google drives"
  ON public.google_drives FOR SELECT
  TO authenticated
  USING (true);

-- user_drive_access policies: Users can only manage their own selections
CREATE POLICY "Users can view own drive selections"
  ON public.user_drive_access FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drive selections"
  ON public.user_drive_access FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own drive selections"
  ON public.user_drive_access FOR DELETE
  USING (auth.uid() = user_id);

-- Comments
COMMENT ON TABLE public.google_drives IS 'Master list of Google Shared Drives synced from Google API';
COMMENT ON TABLE public.user_drive_access IS 'User-specific drive selections for faster filtering';
COMMENT ON COLUMN public.google_drives.drive_id IS 'Google Drive ID from Shared Drive';
COMMENT ON COLUMN public.google_drives.synced_at IS 'Last time this drive was synced from Google API';
COMMENT ON COLUMN public.user_drive_access.drive_id IS 'Reference to google_drives.drive_id';
