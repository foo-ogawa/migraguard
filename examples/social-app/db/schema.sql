COMMENT ON SCHEMA public IS '';

CREATE TABLE public.bookmarks (
    post_id bigint NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.chat_messages (
    id bigint NOT NULL,
    room_id bigint NOT NULL,
    sender_id bigint NOT NULL,
    content text NOT NULL,
    message_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    reply_to_id bigint,
    is_edited boolean DEFAULT false NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chat_messages_message_type_check CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'file'::character varying, 'system'::character varying])::text[])))
);

CREATE SEQUENCE public.chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;

CREATE TABLE public.chat_reactions (
    message_id bigint NOT NULL,
    user_id bigint NOT NULL,
    emoji character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.chat_room_members (
    room_id bigint NOT NULL,
    user_id bigint NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    nickname character varying(50),
    is_muted boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chat_room_members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying])::text[])))
);

CREATE TABLE public.chat_rooms (
    id bigint NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    room_type character varying(20) DEFAULT 'group'::character varying NOT NULL,
    max_members integer DEFAULT 100,
    created_by bigint NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chat_rooms_room_type_check CHECK (((room_type)::text = ANY ((ARRAY['group'::character varying, 'dm'::character varying, 'channel'::character varying])::text[])))
);

CREATE SEQUENCE public.chat_rooms_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.chat_rooms_id_seq OWNED BY public.chat_rooms.id;

CREATE TABLE public.direct_messages (
    id bigint NOT NULL,
    room_id bigint NOT NULL,
    sender_id bigint NOT NULL,
    recipient_id bigint NOT NULL,
    content text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT direct_messages_check CHECK ((sender_id <> recipient_id))
);

CREATE SEQUENCE public.direct_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.direct_messages_id_seq OWNED BY public.direct_messages.id;

CREATE TABLE public.follows (
    follower_id bigint NOT NULL,
    followee_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT follows_check CHECK ((follower_id <> followee_id))
);

CREATE TABLE public.message_read_receipts (
    message_id bigint NOT NULL,
    user_id bigint NOT NULL,
    read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.post_likes (
    post_id bigint NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.posts (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    content text NOT NULL,
    media_urls text[],
    is_public boolean DEFAULT true NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    reply_count integer DEFAULT 0 NOT NULL,
    reply_to_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public.posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.posts_id_seq OWNED BY public.posts.id;

CREATE TABLE public.schema_migrations (
    id bigint NOT NULL,
    file_name character varying(256) NOT NULL,
    checksum character varying(64) NOT NULL,
    status character varying(16) DEFAULT 'applied'::character varying NOT NULL,
    applied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at timestamp with time zone
);

CREATE SEQUENCE public.schema_migrations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.schema_migrations_id_seq OWNED BY public.schema_migrations.id;

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    token character varying(512) NOT NULL,
    ip_address inet,
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.user_notification_settings (
    user_id bigint NOT NULL,
    dm_notify boolean DEFAULT true NOT NULL,
    chat_notify boolean DEFAULT true NOT NULL,
    mention_notify boolean DEFAULT true NOT NULL,
    email_digest character varying(20) DEFAULT 'daily'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_notification_settings_email_digest_check CHECK (((email_digest)::text = ANY ((ARRAY['none'::character varying, 'daily'::character varying, 'weekly'::character varying])::text[])))
);

CREATE TABLE public.users (
    id bigint NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(256) NOT NULL,
    password_hash character varying(256) NOT NULL,
    display_name character varying(100),
    avatar_url text,
    bio text,
    website character varying(512),
    location character varying(100),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);

ALTER TABLE ONLY public.chat_rooms ALTER COLUMN id SET DEFAULT nextval('public.chat_rooms_id_seq'::regclass);

ALTER TABLE ONLY public.direct_messages ALTER COLUMN id SET DEFAULT nextval('public.direct_messages_id_seq'::regclass);

ALTER TABLE ONLY public.posts ALTER COLUMN id SET DEFAULT nextval('public.posts_id_seq'::regclass);

ALTER TABLE ONLY public.schema_migrations ALTER COLUMN id SET DEFAULT nextval('public.schema_migrations_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_pkey PRIMARY KEY (post_id, user_id);

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_reactions
    ADD CONSTRAINT chat_reactions_pkey PRIMARY KEY (message_id, user_id, emoji);

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_pkey PRIMARY KEY (room_id, user_id);

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followee_id);

ALTER TABLE ONLY public.message_read_receipts
    ADD CONSTRAINT message_read_receipts_pkey PRIMARY KEY (message_id, user_id);

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_pkey PRIMARY KEY (post_id, user_id);

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_key UNIQUE (token);

ALTER TABLE ONLY public.user_notification_settings
    ADD CONSTRAINT user_notification_settings_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

CREATE INDEX idx_bookmarks_user ON public.bookmarks USING btree (user_id, created_at DESC);

CREATE INDEX idx_chat_messages_reply ON public.chat_messages USING btree (reply_to_id) WHERE (reply_to_id IS NOT NULL);

CREATE INDEX idx_chat_messages_room ON public.chat_messages USING btree (room_id, created_at DESC);

CREATE INDEX idx_chat_messages_sender ON public.chat_messages USING btree (sender_id);

CREATE INDEX idx_chat_room_members_user ON public.chat_room_members USING btree (user_id);

CREATE INDEX idx_chat_rooms_created_by ON public.chat_rooms USING btree (created_by);

CREATE INDEX idx_chat_rooms_type ON public.chat_rooms USING btree (room_type);

CREATE INDEX idx_dm_recipient_unread ON public.direct_messages USING btree (recipient_id, is_read) WHERE (is_read = false);

CREATE INDEX idx_dm_room ON public.direct_messages USING btree (room_id, created_at DESC);

CREATE INDEX idx_dm_sender ON public.direct_messages USING btree (sender_id);

CREATE INDEX idx_follows_followee ON public.follows USING btree (followee_id);

CREATE INDEX idx_follows_follower ON public.follows USING btree (follower_id);

CREATE INDEX idx_post_likes_user ON public.post_likes USING btree (user_id);

CREATE INDEX idx_posts_created_at ON public.posts USING btree (created_at DESC);

CREATE INDEX idx_posts_reply_to ON public.posts USING btree (reply_to_id) WHERE (reply_to_id IS NOT NULL);

CREATE INDEX idx_posts_user_id ON public.posts USING btree (user_id, created_at DESC);

CREATE INDEX idx_read_receipts_user ON public.message_read_receipts USING btree (user_id, read_at DESC);

CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at);

CREATE INDEX idx_sessions_token ON public.sessions USING btree (token);

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);

CREATE INDEX idx_users_email ON public.users USING btree (email);

CREATE INDEX idx_users_is_active ON public.users USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_users_username ON public.users USING btree (username);

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.chat_reactions
    ADD CONSTRAINT chat_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_reactions
    ADD CONSTRAINT chat_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.message_read_receipts
    ADD CONSTRAINT message_read_receipts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.message_read_receipts
    ADD CONSTRAINT message_read_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.posts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification_settings
    ADD CONSTRAINT user_notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
