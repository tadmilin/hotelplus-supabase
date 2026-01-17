-- เพิ่ม column gpt_output_count สำหรับเก็บจำนวนรูปจาก GPT Image
-- ใช้กับ job_type = 'gpt-with-template' เพื่อแยก section GPT และ Template

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS gpt_output_count INTEGER;

COMMENT ON COLUMN public.jobs.gpt_output_count IS 'จำนวนรูปจาก GPT Image 1.5 (สำหรับ gpt-with-template)';
