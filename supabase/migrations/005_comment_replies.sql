alter table public.comments
  add column parent_comment_id uuid,
  add constraint comments_id_post_id_unique unique (id, post_id),
  add constraint comments_parent_same_post_fk
    foreign key (parent_comment_id, post_id)
    references public.comments (id, post_id)
    on delete cascade;

create index comments_parent_created_idx
  on public.comments (parent_comment_id, created_at);

drop table if exists public.comment_reactions;
