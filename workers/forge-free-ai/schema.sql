-- D1 schema for grudge-forge-free-ai agent jobs
-- Create: wrangler d1 create forge-agent
-- Apply:  wrangler d1 execute forge-agent --file=./schema.sql
-- Bind in wrangler.toml: [[d1_databases]] binding = "DB" database_name = "forge-agent"

CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT,
  result_url TEXT,
  error TEXT,
  meta TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_created ON agent_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status);
