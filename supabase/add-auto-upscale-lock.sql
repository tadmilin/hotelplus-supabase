-- Function to atomically lock auto-upscale for a job
-- Returns TRUE if lock acquired (first caller), FALSE if already locked
-- Uses PostgreSQL's atomic UPDATE with RETURNING to prevent race conditions

CREATE OR REPLACE FUNCTION try_lock_auto_upscale(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- Atomic UPDATE: only updates if autoUpscaleTriggered is NOT true
  -- PostgreSQL ensures this is atomic at database level
  UPDATE jobs
  SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"autoUpscaleTriggered": true}'::jsonb,
      updated_at = NOW()
  WHERE id = p_job_id
    AND (
      metadata IS NULL 
      OR metadata->>'autoUpscaleTriggered' IS NULL 
      OR metadata->>'autoUpscaleTriggered' != 'true'
    );
  
  -- Get number of rows updated
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  -- Return TRUE if we updated (got the lock), FALSE if already locked
  RETURN v_updated_count > 0;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION try_lock_auto_upscale(UUID) TO service_role;

-- Comment
COMMENT ON FUNCTION try_lock_auto_upscale IS 'Atomically locks auto-upscale for a job to prevent duplicate upscale from concurrent webhooks';

-- ============================================================
-- Function to find job by prediction ID in metadata (JSONB search)
-- Much faster than fetching 200 rows and filtering in JS
-- ============================================================

CREATE OR REPLACE FUNCTION find_job_by_prediction(p_prediction_id TEXT)
RETURNS SETOF jobs
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM jobs
  WHERE metadata IS NOT NULL
    AND metadata->'gptPredictions' ? p_prediction_id
    AND status IN ('pending', 'processing', 'processing_template')
    AND created_at > NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC
  LIMIT 1;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION find_job_by_prediction(TEXT) TO service_role;

-- Create index for faster JSONB search (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_jobs_metadata_gpt_predictions 
ON jobs USING GIN ((metadata->'gptPredictions'))
WHERE metadata IS NOT NULL;

COMMENT ON FUNCTION find_job_by_prediction IS 'Find job by prediction ID in metadata.gptPredictions array using JSONB containment';
