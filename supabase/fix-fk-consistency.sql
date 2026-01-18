-- ======================================
-- Fix Foreign Key Consistency
-- ======================================
-- Problem: jobs.user_id → profiles(id) but other tables → auth.users(id)
-- Solution: Change all FKs to point to auth.users(id) for consistency
-- This prevents issues when trigger fails to create profile

-- ======================================
-- 1. Verify Current State
-- ======================================

-- Check current FK constraint
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'jobs' 
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'user_id';

-- Check if there are any orphaned records (jobs without corresponding auth.users)
SELECT COUNT(*) as orphaned_jobs
FROM public.jobs j
LEFT JOIN auth.users u ON j.user_id = u.id
WHERE u.id IS NULL;

-- ======================================
-- 2. Fix FK Constraint (CRITICAL)
-- ======================================

-- Drop old FK constraint pointing to profiles
ALTER TABLE public.jobs 
  DROP CONSTRAINT IF EXISTS jobs_user_id_fkey;

-- Add new FK constraint pointing to auth.users (consistent with other tables)
ALTER TABLE public.jobs 
  ADD CONSTRAINT jobs_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) 
    ON DELETE CASCADE;

-- ======================================
-- 3. Verify Fix
-- ======================================

-- Confirm new FK constraint
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'jobs' 
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'user_id';

-- ======================================
-- 4. Optional: Fix gemini_conversations (if exists)
-- ======================================

-- Check if gemini_conversations has FK to profiles instead of auth.users
DO $$
BEGIN
  -- Drop old FK if it points to profiles
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'gemini_conversations' 
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'profiles'
  ) THEN
    ALTER TABLE public.gemini_conversations 
      DROP CONSTRAINT IF EXISTS gemini_conversations_user_id_fkey;
      
    ALTER TABLE public.gemini_conversations 
      ADD CONSTRAINT gemini_conversations_user_id_fkey 
        FOREIGN KEY (user_id) 
        REFERENCES auth.users(id) 
        ON DELETE CASCADE;
        
    RAISE NOTICE 'Fixed gemini_conversations FK constraint';
  END IF;
END $$;

-- ======================================
-- Summary
-- ======================================

COMMENT ON CONSTRAINT jobs_user_id_fkey ON public.jobs IS 
  'Fixed on 2026-01-18: Changed from profiles(id) to auth.users(id) for FK consistency';

-- Done! Now all tables consistently reference auth.users(id)
-- This prevents issues when:
-- 1. Trigger fails to create profile
-- 2. User exists in auth.users but not in profiles
-- 3. Admin queries JOIN auth.users

SELECT '✅ FK consistency fixed: jobs.user_id now points to auth.users(id)' as status;
