-- Existing short-lived stdio sessions remain valid and are not listed as keys.
alter table mcp_sessions add column if not exists label varchar(100);
create index if not exists mcp_sessions_user_keys_idx on mcp_sessions(user_id) where label is not null;
