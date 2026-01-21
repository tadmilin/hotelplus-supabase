-- 🔐 Fix RLS Security Issues
-- Run this in Supabase SQL Editor

-- ===== 1. Enable RLS on admin_users =====
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- ===== 2. Enable RLS on folder_cache =====
ALTER TABLE public.folder_cache ENABLE ROW LEVEL SECURITY;

-- ===== 3. Add policies for folder_cache =====
-- 🔥 Drop existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated read folder_cache" ON public.folder_cache;
DROP POLICY IF EXISTS "Allow authenticated write folder_cache" ON public.folder_cache;
DROP POLICY IF EXISTS "Service role full access folder_cache" ON public.folder_cache;

-- Allow authenticated users to SELECT from folder_cache
CREATE POLICY "Allow authenticated read folder_cache"
  ON public.folder_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to INSERT/UPDATE folder_cache (for caching)
CREATE POLICY "Allow authenticated write folder_cache"
  ON public.folder_cache
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow service role full access
CREATE POLICY "Service role full access folder_cache"
  ON public.folder_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ===== 4. Verify RLS is enabled =====
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('admin_users', 'folder_cache');

-- ===== 5. List all policies =====
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename IN ('admin_users', 'folder_cache');
