create table if not exists board_comment_threads (
 id uuid primary key,
 project_id uuid not null references projects(id) on delete cascade,
 object_id uuid references board_objects(id) on delete set null,
 x double precision not null,
 y double precision not null,
 created_by text not null references "user"(id),
 created_at timestamptz not null default now()
);
create index if not exists board_comment_threads_project_idx on board_comment_threads(project_id,created_at);
create table if not exists board_comments (
 id uuid primary key,
 thread_id uuid not null references board_comment_threads(id) on delete cascade,
 author_id text not null references "user"(id),
 body text not null,
 created_at timestamptz not null default now()
);
create index if not exists board_comments_thread_idx on board_comments(thread_id,created_at);
