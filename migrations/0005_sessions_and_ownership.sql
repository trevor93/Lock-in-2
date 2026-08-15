-- ============================================================
-- 0005 BOOK 5.2 — durable users, revocable hashed sessions,
-- and ownership for every current personal table.
-- ============================================================
-- Production precondition: complete OPERATIONS.md Section 4 first.
-- Rollback: deploy the prior application while retaining this additive
-- ownership schema. Do not drop columns/tables or restore D1 without
-- explicit destructive-operation approval. See OPERATIONS.md Section 5.1.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  password_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Preserve an already-configured installation by promoting its existing
-- password verifier into the durable owner record. No raw password exists.
INSERT INTO users (password_hash, password_salt, role)
SELECT password_hash.value, password_salt.value, 'owner'
FROM settings AS password_hash
JOIN settings AS password_salt ON password_salt.key = 'auth_salt'
WHERE password_hash.key = 'auth_hash'
  AND NOT EXISTS (SELECT 1 FROM users);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  rotated_from_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (rotated_from_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id, revoked_at, expires_at);

-- Add ownership without deleting or rebuilding existing records. This application
-- remains a durable single-owner installation: the user_id boundary is enforced on
-- every personal route, and legacy global uniqueness remains intentionally intact.
ALTER TABLE schedule_blocks ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE block_logs ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE debriefs ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE unit_progress ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE maxims ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE flashcards ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE card_reviews ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE honesty_flags ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE points_ledger ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE reward_redemptions ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE law_checks ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE settings ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE intel_entries ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE book_progress ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE hermes_messages ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE responses ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE response_srs ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE tongue_reviews ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE tongue_exams ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE day_summary ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE predictions ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE appeals ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE load_reductions ADD COLUMN user_id INTEGER REFERENCES users(id);

UPDATE schedule_blocks SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE block_logs SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE debriefs SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE unit_progress SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE maxims SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE flashcards SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE card_reviews SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE honesty_flags SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE points_ledger SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE reward_redemptions SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE law_checks SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE settings SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE intel_entries SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE book_progress SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE hermes_messages SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE responses SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE response_srs SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE tongue_reviews SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE tongue_exams SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE day_summary SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE predictions SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE appeals SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
UPDATE load_reductions SET user_id=(SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_blocks_user ON schedule_blocks(user_id, start_time, sort_order);
CREATE INDEX IF NOT EXISTS idx_block_logs_user_date ON block_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_debriefs_user_date ON debriefs(user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_unit_progress_user_status ON unit_progress(user_id, status, unit_id);
CREATE INDEX IF NOT EXISTS idx_maxims_user ON maxims(user_id, source, id);
CREATE INDEX IF NOT EXISTS idx_flashcards_user_due ON flashcards(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_card_reviews_user_time ON card_reviews(user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_honesty_flags_user_time ON honesty_flags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_user_date ON points_ledger(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user ON reward_redemptions(user_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_law_checks_user_date ON law_checks(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key);
CREATE INDEX IF NOT EXISTS idx_intel_user_date ON intel_entries(user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_book_progress_user_book ON book_progress(user_id, book_id, chapter_idx);
CREATE INDEX IF NOT EXISTS idx_hermes_user_time ON hermes_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_user ON responses(user_id, archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_response_srs_user_due ON response_srs(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tongue_reviews_user_date ON tongue_reviews(user_id, review_date);
CREATE INDEX IF NOT EXISTS idx_tongue_exams_user_date ON tongue_exams(user_id, exam_date);
CREATE INDEX IF NOT EXISTS idx_day_summary_user_victory ON day_summary(user_id, victory, summary_date);
CREATE INDEX IF NOT EXISTS idx_predictions_user_open ON predictions(user_id, outcome, resolve_by);
CREATE INDEX IF NOT EXISTS idx_appeals_user_time ON appeals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_load_reductions_user_date ON load_reductions(user_id, end_date);

-- Book 5.2 requires durable ownership and denial, not self-service multi-tenancy.
-- A future explicit multi-user feature would require a separate table-rebuild
-- migration widening legacy global keys; this migration makes no such claim.
