-- Actual Budget Supabase (PostgreSQL) Schema

-- 1. Authentication Methods
CREATE TABLE IF NOT EXISTS auth (
    method TEXT PRIMARY KEY,
    display_name TEXT,
    extra_data TEXT,
    active INTEGER DEFAULT 1
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    user_name TEXT,
    display_name TEXT,
    role TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    owner INTEGER NOT NULL DEFAULT 0
);

-- 3. Files (Budget Metadata)
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    group_id TEXT,
    sync_version SMALLINT,
    encrypt_meta TEXT,
    encrypt_keyid TEXT,
    encrypt_salt TEXT,
    encrypt_test TEXT,
    deleted BOOLEAN DEFAULT FALSE,
    name TEXT,
    owner TEXT
);

-- 4. Sessions
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    expires_at BIGINT, -- Using BIGINT for unix timestamps
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    auth_method TEXT
);

-- 5. User Access (Permissions)
CREATE TABLE IF NOT EXISTS user_access (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, file_id)
);

-- 6. Secrets (for Bank Sync)
CREATE TABLE IF NOT EXISTS secrets (
    name TEXT PRIMARY KEY,
    value TEXT
);

-- 7. Budget Sync Messages
CREATE TABLE IF NOT EXISTS messages_binary (
    group_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    is_encrypted BOOLEAN,
    content BYTEA,
    PRIMARY KEY (group_id, timestamp)
);

-- 8. Budget Sync Merkles
CREATE TABLE IF NOT EXISTS messages_merkles (
    group_id TEXT PRIMARY KEY,
    merkle TEXT
);

-- 9. Pending OpenID Requests
CREATE TABLE IF NOT EXISTS pending_openid_requests (
    state TEXT PRIMARY KEY,
    code_verifier TEXT,
    return_url TEXT,
    expiry_time BIGINT
);

-- Note: Actual Budget will bootstrap itself on first run if the 'auth' table is empty.
-- However, for PostgreSQL, you might want to pre-seed the auth method if you aren't using the UI bootstrap.
-- The server will handle this automatically if it sees an empty auth table.
