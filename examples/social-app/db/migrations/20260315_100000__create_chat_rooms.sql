-- Sprint 3: チャットシステム
-- チャットルーム・メンバー管理

CREATE TABLE IF NOT EXISTS chat_rooms (
    id          BIGSERIAL    PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    room_type   VARCHAR(20)  NOT NULL DEFAULT 'group'
                             CHECK (room_type IN ('group', 'dm', 'channel')),
    max_members INT          DEFAULT 100,
    created_by  BIGINT       NOT NULL REFERENCES users(id),
    is_archived BOOLEAN      NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_type ON chat_rooms (room_type);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_created_by ON chat_rooms (created_by);

CREATE TABLE IF NOT EXISTS chat_room_members (
    room_id   BIGINT      NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      VARCHAR(20) NOT NULL DEFAULT 'member'
                          CHECK (role IN ('owner', 'admin', 'member')),
    nickname  VARCHAR(50),
    is_muted  BOOLEAN     NOT NULL DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members (user_id);
