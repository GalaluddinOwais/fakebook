alter table public.posts
 alter column ai_reactions_interval_ms set default 2000;

update public.posts
set ai_reactions_interval_ms=2000,
    ai_reactions_next_at=now()
where ai_likes_shown<ai_likes_decided
   or ai_dislikes_shown<ai_dislikes_decided
   or ai_haha_shown<ai_haha_decided;
