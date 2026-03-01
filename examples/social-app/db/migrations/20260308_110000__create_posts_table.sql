-- Sprint 2: SNS and user relationships
-- Posts, likes, and bookmarks tables

CREATE TABLE IF NOT EXISTS posts (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT         NOT NULL,
    media_urls  TEXT[],
    is_public   BOOLEAN      NOT NULL DEFAULT true,
    like_count  INT          NOT NULL DEFAULT 0,
    reply_count INT          NOT NULL DEFAULT 0,
    reply_to_id BIGINT       REFERENCES posts(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_reply_to ON posts (reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
    post_id    BIGINT      NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes (user_id);

CREATE TABLE IF NOT EXISTS bookmarks (
    post_id    BIGINT      NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks (user_id, created_at DESC);
