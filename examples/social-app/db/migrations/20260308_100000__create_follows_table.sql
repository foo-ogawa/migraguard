-- Sprint 2: SNS and user relationships
-- Follow/follower relationship table

CREATE TABLE IF NOT EXISTS follows (
    follower_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows (followee_id);
