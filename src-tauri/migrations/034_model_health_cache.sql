CREATE TABLE IF NOT EXISTS model_health_cache (
  provider_id   TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  api_key_hash  TEXT NOT NULL,
  status        TEXT NOT NULL,
  http_code     INTEGER,
  latency_ms    INTEGER,
  quota_percent INTEGER,
  checked_at    INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id, api_key_hash)
);
