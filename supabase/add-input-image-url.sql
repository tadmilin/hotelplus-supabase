-- Add input_image_url column to jobs table
-- This stores the original image URL for upscale jobs (to show before/after comparison)

ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS input_image_url TEXT;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_jobs_input_image_url ON public.jobs(input_image_url);

-- Comment
COMMENT ON COLUMN public.jobs.input_image_url IS 'Original input image URL (for upscale jobs to show before/after)';
