-- ======================================
-- Create Excluded Folders Table
-- ======================================
-- Purpose: Allow users to hide/exclude specific folders from Google Drive
-- This makes loading faster by filtering out unused folders

CREATE TABLE IF NOT EXISTS public.excluded_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_email TEXT NOT NULL,
  folder_id TEXT NOT NULL, -- Google Drive folder ID
  folder_name TEXT NOT NULL, -- For display purposes
  drive_id TEXT NOT NULL, -- Which drive this folder belongs to
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_excluded_folders_user_id ON public.excluded_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_excluded_folders_folder_id ON public.excluded_folders(folder_id);
CREATE INDEX IF NOT EXISTS idx_excluded_folders_user_folder ON public.excluded_folders(user_id, folder_id);

-- Enable RLS
ALTER TABLE public.excluded_folders ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only manage their own excluded folders
CREATE POLICY "Users can view own excluded folders"
  ON public.excluded_folders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own excluded folders"
  ON public.excluded_folders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own excluded folders"
  ON public.excluded_folders FOR DELETE
  USING (auth.uid() = user_id);

-- Comments
COMMENT ON TABLE public.excluded_folders IS 'User-specific blacklist of Google Drive folders to hide from UI';
COMMENT ON COLUMN public.excluded_folders.folder_id IS 'Google Drive folder ID to exclude';
COMMENT ON COLUMN public.excluded_folders.folder_name IS 'Folder name for display (snapshot at exclusion time)';
COMMENT ON COLUMN public.excluded_folders.drive_id IS 'Parent drive ID for reference';

SELECT '✅ excluded_folders table created successfully' as status;
