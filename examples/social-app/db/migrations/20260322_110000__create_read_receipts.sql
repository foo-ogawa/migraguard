-- Sprint 4: Direct messaging
-- Read receipt management (read receipts for group chat)

CREATE TABLE IF NOT EXISTS message_read_receipts (
    message_id BIGINT      NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_read_receipts_user ON message_read_receipts (user_id, read_at DESC);

CREATE TABLE IF NOT EXISTS user_notification_settings (
    user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
    dm_notify       BOOLEAN     NOT NULL DEFAULT true,
    chat_notify     BOOLEAN     NOT NULL DEFAULT true,
    mention_notify  BOOLEAN     NOT NULL DEFAULT true,
    email_digest    VARCHAR(20) NOT NULL DEFAULT 'daily'
                                CHECK (email_digest IN ('none', 'daily', 'weekly')),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
