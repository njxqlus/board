-- Restricted MCP bearer sessions are authentication state and must disappear
-- with the account rather than blocking account cleanup.
alter table mcp_sessions
 drop constraint if exists mcp_sessions_user_id_fkey;
alter table mcp_sessions
 add constraint mcp_sessions_user_id_fkey
 foreign key (user_id) references "user"(id) on delete cascade;
