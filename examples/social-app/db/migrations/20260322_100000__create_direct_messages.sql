-- Sprint 4: DM 機能
-- DM 専用テーブル（chat_rooms の room_type='dm' と連携）

CREATE TABLE IF NOT EXISTS direct_messages (
    id           BIGSERIAL   PRIMARY KEY,
    room_id      BIGINT      NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id    BIGINT      NOT NULL REFERENCES users(id),
    recipient_id BIGINT      NOT NULL REFERENCES users(id),
    content      TEXT        NOT NULL,
    is_read      BOOLEAN     NOT NULL DEFAULT false,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_room ON direct_messages (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_recipient_unread ON direct_messages (recipient_id, is_read)
    WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages (sender_id);
