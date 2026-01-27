-- =============================================================================
-- Freepik Integration Schema
-- Add support for Freepik AI jobs (separate from Replicate)
-- =============================================================================

-- Add freepik_task_id column to jobs table (for Freepik task tracking)
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS freepik_task_id TEXT;

-- Add freepik_status column to jobs table
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS freepik_status TEXT;

-- Add freepik_step column to track webhook chain progress
-- Values: 'image-to-prompt', 'improve-prompt', 'mystic', 'completed'
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS freepik_step TEXT;

-- Add metadata column for storing generation config (JSON)
-- Used to pass config between webhook chain steps
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add index for freepik_task_id lookups (used by webhook)
CREATE INDEX IF NOT EXISTS idx_jobs_freepik_task_id 
ON public.jobs(freepik_task_id) 
WHERE freepik_task_id IS NOT NULL;

-- Add 'freepik' to job_type enum values (optional: for filtering)
-- Note: job_type is currently TEXT, so no enum constraint needed

-- =============================================================================
-- RLS Policy for freepik jobs (uses existing policies)
-- Jobs table already has proper RLS policies in place
-- =============================================================================

-- Add policy for service role to update jobs via webhook
-- (This policy allows webhook to update any job without user auth)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'jobs' 
    AND policyname = 'Service role can update all jobs'
  ) THEN
    CREATE POLICY "Service role can update all jobs"
      ON public.jobs FOR UPDATE
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- Comments for documentation
-- =============================================================================
COMMENT ON COLUMN public.jobs.freepik_task_id IS 'Freepik API task ID for webhook tracking';
COMMENT ON COLUMN public.jobs.freepik_status IS 'Freepik task status: CREATED, IN_PROGRESS, COMPLETED, FAILED';
