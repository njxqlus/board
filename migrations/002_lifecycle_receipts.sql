-- Lifecycle mutations are not board-content commands, but need the same retry
-- guarantees for MCP and browser clients (including project creation).
create table if not exists lifecycle_receipts (
 actor_id text not null references "user"(id),
 operation_id uuid not null,
 request_hash text not null,
 result jsonb not null,
 expires_at timestamptz not null,
 primary key(actor_id,operation_id)
);
create index if not exists lifecycle_receipts_expiry_idx on lifecycle_receipts(expires_at);
