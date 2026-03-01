-- Sprint 3: Chat system
-- Messages and reactions

CREATE TABLE IF NOT EXISTS chat_messages (
    id           BIGSERIAL    PRIMARY KEY,
    room_id      BIGINT       NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id    BIGINT       NOT NULL REFERENCES users(id),
    content      TEXT         NOT NULL,
    message_type VARCHAR(20)  NOT NULL DEFAULT 'text'
                              CHECK (message_type IN ('text', 'image', 'file', 'system')),
    reply_to_id  BIGINT       REFERENCES chat_messages(id) ON DELETE SET NULL,
    is_edited    BOOLEAN      NOT NULL DEFAULT false,
    is_deleted   BOOLEAN      NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply ON chat_messages (reply_to_id)
    WHERE reply_to_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id BIGINT      NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id, emoji)
);
