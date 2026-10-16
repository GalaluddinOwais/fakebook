alter table public.posts
 add column ai_likes_decided integer not null default 0 check(ai_likes_decided between 0 and 10000),
 add column ai_dislikes_decided integer not null default 0 check(ai_dislikes_decided between 0 and 10000),
 add column ai_haha_decided integer not null default 0 check(ai_haha_decided between 0 and 10000),
 add column ai_likes_shown integer not null default 0 check(ai_likes_shown between 0 and ai_likes_decided),
 add column ai_dislikes_shown integer not null default 0 check(ai_dislikes_shown between 0 and ai_dislikes_decided),
 add column ai_haha_shown integer not null default 0 check(ai_haha_shown between 0 and ai_haha_decided),
 add column ai_reactions_next_at timestamptz,
 add column ai_reactions_interval_ms integer not null default 1000 check(ai_reactions_interval_ms between 100 and 60000);

create or replace function public.apply_ai_event(p_event_id uuid,p_thread_id uuid,p_summary text,p_actions jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
 a jsonb;
 pid uuid;
 target uuid;
begin
 if not exists(select 1 from ai_event_runs where event_id=p_event_id and status='processing') then
  raise exception 'event not claimed';
 end if;

 insert into thread_memories(thread_id,summary,updated_at)
 values(p_thread_id,left(p_summary,700),now())
 on conflict(thread_id) do update set summary=excluded.summary,updated_at=now();

 for a in select value from jsonb_array_elements(p_actions) loop
  if a->>'type'='reaction_batch' then
   update posts set
    ai_likes_decided=greatest(0,least(10000,coalesce((a->>'likes')::integer,0))),
    ai_dislikes_decided=greatest(0,least(10000,coalesce((a->>'dislikes')::integer,0))),
    ai_haha_decided=greatest(0,least(10000,coalesce((a->>'haha')::integer,0))),
    ai_likes_shown=0,
    ai_dislikes_shown=0,
    ai_haha_shown=0,
    ai_reactions_interval_ms=greatest(100,least(60000,coalesce((a->>'interval_ms')::integer,1000))),
    ai_reactions_next_at=now()
   where id=p_thread_id;
   continue;
  end if;

  pid:=nullif(a->>'profile_id','')::uuid;
  target:=nullif(a->>'target_id','')::uuid;
  if not is_ai(pid) then continue; end if;
  if a->>'type'='comment' and target=p_thread_id and length(trim(a->>'content')) between 1 and 500 then
   insert into comments(post_id,author_id,content)
   values(p_thread_id,pid,left(a->>'content',500));
  end if;
 end loop;

 update ai_event_runs set status='done' where event_id=p_event_id;
end;
$$;

revoke all on function public.apply_ai_event(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_ai_event(uuid,uuid,text,jsonb) to service_role;

create or replace function public.advance_post_ai_reactions(p_post_id uuid)
returns table(likes integer,dislikes integer,haha integer)
language plpgsql security definer set search_path=public as $$
declare
 v_now timestamptz:=now();
 v_likes integer;
 v_dislikes integer;
 v_haha integer;
 v_likes_target integer;
 v_dislikes_target integer;
 v_haha_target integer;
 v_next timestamptz;
 v_interval integer;
begin
 select ai_likes_shown,ai_dislikes_shown,ai_haha_shown,
        ai_likes_decided,ai_dislikes_decided,ai_haha_decided,
        ai_reactions_next_at,ai_reactions_interval_ms
 into v_likes,v_dislikes,v_haha,v_likes_target,v_dislikes_target,v_haha_target,v_next,v_interval
 from posts where id=p_post_id for update;
 if not found then return; end if;

 if (v_next is null or v_now>=v_next) and
    (v_likes<v_likes_target or v_dislikes<v_dislikes_target or v_haha<v_haha_target) then
  v_likes:=least(v_likes_target,v_likes+greatest(1,ceil(v_likes_target::numeric/30)::integer));
  v_dislikes:=least(v_dislikes_target,v_dislikes+greatest(1,ceil(v_dislikes_target::numeric/30)::integer));
  v_haha:=least(v_haha_target,v_haha+greatest(1,ceil(v_haha_target::numeric/30)::integer));
  update posts set ai_likes_shown=v_likes,ai_dislikes_shown=v_dislikes,ai_haha_shown=v_haha,
                   ai_reactions_next_at=v_now+make_interval(secs=>v_interval::double precision/1000.0)
   where id=p_post_id;
 end if;
 return query select v_likes,v_dislikes,v_haha;
end;
$$;

revoke all on function public.advance_post_ai_reactions(uuid) from public,anon,authenticated;
grant execute on function public.advance_post_ai_reactions(uuid) to service_role;
