alter table public.comments
  add column visible_at timestamptz not null default now();

create index comments_post_visible_idx
  on public.comments (post_id, visible_at, created_at);
