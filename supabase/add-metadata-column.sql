-- Add metadata column to jobs table for pipeline tracking
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- Add index for faster metadata queries
CREATE INDEX IF NOT EXISTS idx_jobs_metadata ON public.jobs USING GIN (metadata);

-- Comment
COMMENT ON COLUMN public.jobs.metadata IS 'JSON metadata for pipeline tracking (gpt-with-template, etc.)';
