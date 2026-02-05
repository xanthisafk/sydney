-- Sydney Media Service - D1 Schema
-- Run with: wrangler d1 execute edge-asset-manager --file=schema.sql

CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    total_bytes INTEGER NOT NULL,
    checksum TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);
CREATE INDEX IF NOT EXISTS idx_media_created_at ON media(created_at);
