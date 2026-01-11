-- Add new columns for GPT Image 1.5 support
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS aspect_ratio TEXT,
ADD COLUMN IF NOT EXISTS quality TEXT,
ADD COLUMN IF NOT EXISTS output_format TEXT,
ADD COLUMN IF NOT EXISTS background TEXT,
ADD COLUMN IF NOT EXISTS moderation TEXT,
ADD COLUMN IF NOT EXISTS input_fidelity TEXT,
ADD COLUMN IF NOT EXISTS output_compression INTEGER,
ADD COLUMN IF NOT EXISTS number_of_images INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN public.jobs.aspect_ratio IS 'GPT Image aspect ratio: 1:1, 3:2, 2:3';
COMMENT ON COLUMN public.jobs.quality IS 'GPT Image quality: auto, low, medium, high';
COMMENT ON COLUMN public.jobs.output_format IS 'Output format: webp, png, jpg';
COMMENT ON COLUMN public.jobs.background IS 'Background type: auto, opaque, transparent';
COMMENT ON COLUMN public.jobs.moderation IS 'Moderation level: auto, strict, relaxed';
COMMENT ON COLUMN public.jobs.input_fidelity IS 'Input fidelity: low, medium, high';
COMMENT ON COLUMN public.jobs.output_compression IS 'Output compression: 0-100';
COMMENT ON COLUMN public.jobs.number_of_images IS 'Number of images to generate: 1-10';
