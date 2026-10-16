create or replace function public.apply_ai_event(p_event_id uuid,p_thread_id uuid,p_summary text,p_actions jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
 a jsonb;
 pid uuid;
 target uuid;
 reaction_at timestamptz;
begin
 if not exists(select 1 from ai_event_runs where event_id=p_event_id and status='processing') then
  raise exception 'event not claimed';
 end if;

 insert into thread_memories(thread_id,summary,updated_at)
 values(p_thread_id,left(p_summary,700),now())
 on conflict(thread_id) do update set summary=excluded.summary,updated_at=now();

 for a in select value from jsonb_array_elements(p_actions) loop
  pid:=(a->>'profile_id')::uuid;
  target:=nullif(a->>'target_id','')::uuid;
  if not is_ai(pid) then continue; end if;

  if a->>'type'='comment' and target=p_thread_id and length(trim(a->>'content')) between 1 and 500 then
   insert into comments(post_id,author_id,content)
   values(p_thread_id,pid,left(a->>'content',500));
  elsif a->>'type'='reaction' and target=p_thread_id and a->>'reaction' in ('like','dislike','haha') then
   reaction_at:=coalesce(nullif(a->>'created_at','')::timestamptz,now());
   insert into post_reactions(post_id,user_id,reaction,created_at)
   values(target,pid,(a->>'reaction')::reaction_kind,reaction_at)
   on conflict(post_id,user_id) do update
   set reaction=excluded.reaction,created_at=excluded.created_at;
  end if;
 end loop;

 update ai_event_runs set status='done' where event_id=p_event_id;
end;
$$;

revoke all on function public.apply_ai_event(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_ai_event(uuid,uuid,text,jsonb) to service_role;
