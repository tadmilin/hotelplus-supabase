-- สร้างตาราง gemini_conversations สำหรับเก็บ chat history
CREATE TABLE IF NOT EXISTS gemini_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New Conversation',
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index สำหรับ query ที่เร็วขึ้น
CREATE INDEX IF NOT EXISTS idx_gemini_conversations_user_id ON gemini_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_gemini_conversations_created_at ON gemini_conversations(created_at DESC);

-- RLS Policies
ALTER TABLE gemini_conversations ENABLE ROW LEVEL SECURITY;

-- Users can read their own conversations
CREATE POLICY "Users can read own conversations"
  ON gemini_conversations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own conversations
CREATE POLICY "Users can insert own conversations"
  ON gemini_conversations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own conversations
CREATE POLICY "Users can update own conversations"
  ON gemini_conversations
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own conversations
CREATE POLICY "Users can delete own conversations"
  ON gemini_conversations
  FOR DELETE
  USING (auth.uid() = user_id);

-- Function สำหรับ auto-update updated_at
CREATE OR REPLACE FUNCTION update_gemini_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger สำหรับ auto-update updated_at
DROP TRIGGER IF EXISTS gemini_conversations_updated_at ON gemini_conversations;
CREATE TRIGGER gemini_conversations_updated_at
  BEFORE UPDATE ON gemini_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_gemini_conversations_updated_at();
