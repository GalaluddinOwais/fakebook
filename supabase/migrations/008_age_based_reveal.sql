-- Reveal AI comments and reactions along one shared timeline measured from
-- the post's creation time. Each planned top-level AI comment is one interval.
alter table public.posts
  alter column ai_reactions_interval_ms set default 60000;

update public.posts
set ai_reactions_interval_ms = 60000
where ai_likes_shown < ai_likes_decided
   or ai_dislikes_shown < ai_dislikes_decided
   or ai_haha_shown < ai_haha_decided;

create or replace function public.advance_post_ai_reactions(p_post_id uuid)
returns table(likes integer,dislikes integer,haha integer)
language plpgsql security definer set search_path=public as $$
declare
  v_now timestamptz := now();
  v_created_at timestamptz;
  v_likes integer;
  v_dislikes integer;
  v_haha integer;
  v_likes_decided integer;
  v_dislikes_decided integer;
  v_haha_decided integer;
  v_interval integer;
  v_steps integer;
  v_elapsed_steps integer;
  v_next_at timestamptz;
begin
  select p.created_at,p.ai_likes_shown,p.ai_dislikes_shown,p.ai_haha_shown,
         p.ai_likes_decided,p.ai_dislikes_decided,p.ai_haha_decided,
         p.ai_reactions_next_at,p.ai_reactions_interval_ms
  into v_created_at,v_likes,v_dislikes,v_haha,
       v_likes_decided,v_dislikes_decided,v_haha_decided,v_next_at,v_interval
  from public.posts p where p.id=p_post_id for update;
  if not found then return; end if;

  select greatest(1,count(*)::integer) into v_steps
  from public.comments c
  join public.profiles pr on pr.id=c.author_id
  where c.post_id=p_post_id
    and c.parent_comment_id is null
    and pr.account_type='ai';

  v_interval := greatest(1000,coalesce(v_interval,60000));
  v_steps := greatest(1,least(20,coalesce(v_steps,10)));
  v_elapsed_steps := least(v_steps,greatest(0,
    floor(extract(epoch from (v_now-v_created_at))*1000/v_interval)::integer));

  v_likes := greatest(v_likes,case when v_likes_decided=0 then 0 else
    least(v_likes_decided,greatest(1,1+floor((v_likes_decided-1)::numeric*v_elapsed_steps/v_steps)::integer)) end);
  v_dislikes := greatest(v_dislikes,case when v_dislikes_decided=0 then 0 else
    least(v_dislikes_decided,greatest(1,1+floor((v_dislikes_decided-1)::numeric*v_elapsed_steps/v_steps)::integer)) end);
  v_haha := greatest(v_haha,case when v_haha_decided=0 then 0 else
    least(v_haha_decided,greatest(1,1+floor((v_haha_decided-1)::numeric*v_elapsed_steps/v_steps)::integer)) end);

  v_next_at := case when v_elapsed_steps < v_steps
    then v_created_at + ((v_elapsed_steps+1)*v_interval)*interval '1 millisecond'
    else null end;

  update public.posts
  set ai_likes_shown=v_likes,
      ai_dislikes_shown=v_dislikes,
      ai_haha_shown=v_haha,
      ai_reactions_next_at=v_next_at
  where id=p_post_id;

  return query select v_likes,v_dislikes,v_haha;
end;
$$;

revoke all on function public.advance_post_ai_reactions(uuid) from public,anon,authenticated;
grant execute on function public.advance_post_ai_reactions(uuid) to service_role;
