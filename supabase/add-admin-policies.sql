-- Add admin bypass policies for jobs table
-- This allows admin users to view/manage all jobs without RLS restrictions

-- Drop existing policies first (to recreate with admin support)
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can delete own jobs" ON public.jobs;

-- Recreate policies with admin bypass
-- Admins can view all jobs, regular users can only view their own
CREATE POLICY "Users can view jobs"
  ON public.jobs FOR SELECT
  USING (
    auth.uid() = user_id 
    OR 
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- Admins can update all jobs, regular users can only update their own
CREATE POLICY "Users can update jobs"
  ON public.jobs FOR UPDATE
  USING (
    auth.uid() = user_id 
    OR 
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- Admins can delete all jobs, regular users can only delete their own
CREATE POLICY "Users can delete jobs"
  ON public.jobs FOR DELETE
  USING (
    auth.uid() = user_id 
    OR 
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'jobs';
