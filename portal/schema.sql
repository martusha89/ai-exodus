-- AI Exodus Portal — D1 Schema
-- Per-user deployed archive + analysis portal

-- Auth
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Imported conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT,
  updated_at TEXT,
  message_count INTEGER DEFAULT 0,
  model TEXT,
  source TEXT DEFAULT 'chatgpt',
  metadata TEXT DEFAULT '{}',
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_model ON conversations(model);
CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);

-- Individual messages
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  created_at TEXT,
  position INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, position);
CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
CREATE INDEX IF NOT EXISTS idx_messages_model ON messages(model);

-- Skill categories (user-editable + defaults)
CREATE TABLE IF NOT EXISTS skill_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#8b5cf6',
  icon TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Default skill categories
INSERT OR IGNORE INTO skill_categories (name, color, icon, is_default, sort_order) VALUES
  ('emotional_support', '#ef4444', '', 1, 1),
  ('creative', '#f59e0b', '', 1, 2),
  ('productivity', '#10b981', '', 1, 3),
  ('coding', '#3b82f6', '', 1, 4),
  ('knowledge', '#8b5cf6', '', 1, 5),
  ('decision_making', '#ec4899', '', 1, 6),
  ('health', '#14b8a6', '', 1, 7),
  ('intimate', '#f43f5e', '', 1, 8),
  ('entertainment', '#f97316', '', 1, 9),
  ('other', '#6b7280', '', 1, 10);

-- Skills (auto-extracted + user-editable)
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  frequency TEXT DEFAULT 'occasional',
  description TEXT,
  approach TEXT,
  quality TEXT,
  activation_rule TEXT,
  triggers_phrases TEXT DEFAULT '[]',
  triggers_temporal TEXT DEFAULT '[]',
  triggers_emotional TEXT DEFAULT '[]',
  triggers_contextual TEXT DEFAULT '[]',
  examples TEXT DEFAULT '[]',
  source TEXT DEFAULT 'extracted',
  run_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Memory categories (user-editable + defaults)
CREATE TABLE IF NOT EXISTS memory_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#8b5cf6',
  icon TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Default memory categories
INSERT OR IGNORE INTO memory_categories (name, color, icon, is_default, sort_order) VALUES
  ('identity', '#3b82f6', '', 1, 1),
  ('life', '#10b981', '', 1, 2),
  ('preferences', '#f59e0b', '', 1, 3),
  ('personality', '#8b5cf6', '', 1, 4),
  ('relationship', '#ef4444', '', 1, 5),
  ('timeline', '#ec4899', '', 1, 6),
  ('emotional', '#f43f5e', '', 1, 7),
  ('facts', '#6b7280', '', 1, 8);

-- Memories (auto-extracted + user-editable)
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'facts',
  key TEXT,
  value TEXT NOT NULL,
  confidence TEXT DEFAULT 'extracted',
  source TEXT DEFAULT 'extracted',
  run_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);

-- Persona (editable text blocks)
CREATE TABLE IF NOT EXISTS persona (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Analysis runs history
CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT DEFAULT 'pending',
  passes TEXT DEFAULT '[]',
  model TEXT DEFAULT 'sonnet',
  date_from TEXT,
  date_to TEXT,
  model_filter TEXT,
  conversation_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  results TEXT DEFAULT '{}',
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  error TEXT
);

-- Relationship narrative
CREATE TABLE IF NOT EXISTS narratives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  run_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
