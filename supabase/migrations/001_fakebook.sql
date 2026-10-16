create extension if not exists pgcrypto;
create type public.account_type as enum ('human','ai');
create type public.post_kind as enum ('original','share');
create type public.reaction_kind as enum ('like','dislike','haha');
create table public.profiles (
 id uuid primary key, username text not null unique check(username ~ '^[a-z0-9_]{3,24}$'), display_name text not null check(length(display_name) between 1 and 60), bio text not null default '' check(length(bio)<=240), avatar_url text, account_type public.account_type not null default 'human', personality text, writing_style text, created_at timestamptz not null default now()
);
create table public.posts (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references profiles(id) on delete cascade, content text not null default '' check(length(content)<=2000), kind public.post_kind not null default 'original', original_post_id uuid references posts(id) on delete cascade, created_at timestamptz not null default now(), check((kind='original' and original_post_id is null and length(trim(content))>0) or (kind='share' and original_post_id is not null))
);
create table public.comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references posts(id) on delete cascade,author_id uuid not null references profiles(id) on delete cascade,content text not null check(length(trim(content)) between 1 and 1000),created_at timestamptz not null default now());
create table public.post_reactions(id uuid primary key default gen_random_uuid(),post_id uuid not null references posts(id) on delete cascade,user_id uuid not null references profiles(id) on delete cascade,reaction public.reaction_kind not null,created_at timestamptz not null default now(),unique(post_id,user_id));
create table public.comment_reactions(id uuid primary key default gen_random_uuid(),comment_id uuid not null references comments(id) on delete cascade,user_id uuid not null references profiles(id) on delete cascade,reaction public.reaction_kind not null,created_at timestamptz not null default now(),unique(comment_id,user_id));
create table public.thread_memories(thread_id uuid primary key references posts(id) on delete cascade,summary text not null default '' check(length(summary)<=700),updated_at timestamptz not null default now());
create table public.ai_event_runs(event_id uuid primary key,status text not null default 'processing' check(status in ('processing','done','failed')),created_at timestamptz not null default now());
create index posts_created_at_idx on posts(created_at desc); create index comments_post_created_idx on comments(post_id,created_at desc);

create function public.is_ai(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=p_id and account_type='ai') $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,username,display_name) values(new.id,coalesce(nullif(lower(new.raw_user_meta_data->>'username'),''),'user_'||substr(new.id::text,1,8)),coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Neighbor')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table profiles enable row level security; alter table posts enable row level security; alter table comments enable row level security; alter table post_reactions enable row level security; alter table comment_reactions enable row level security; alter table thread_memories enable row level security; alter table ai_event_runs enable row level security;
create policy "Profiles readable" on profiles for select using(true);
create policy "Human creates own profile" on profiles for insert with check(auth.uid()=id and account_type='human');
create policy "Human edits own profile" on profiles for update using(auth.uid()=id and account_type='human') with check(auth.uid()=id and account_type='human');
create policy "Posts readable" on posts for select using(true);
create policy "Human creates posts" on posts for insert with check(auth.uid()=author_id and not is_ai(auth.uid()) and ((kind='original' and original_post_id is null) or kind='share'));
create policy "Human updates own posts" on posts for update using(auth.uid()=author_id and not is_ai(auth.uid())) with check(auth.uid()=author_id and not is_ai(auth.uid()));
create policy "Human deletes own posts" on posts for delete using(auth.uid()=author_id and not is_ai(auth.uid()));
create policy "Comments readable" on comments for select using(true);
create policy "Human comments" on comments for insert with check(auth.uid()=author_id and not is_ai(auth.uid()));
create policy "Human deletes own comments" on comments for delete using(auth.uid()=author_id and not is_ai(auth.uid()));
create policy "Reactions readable" on post_reactions for select using(true); create policy "Own human post reactions" on post_reactions for all using(auth.uid()=user_id and not is_ai(auth.uid())) with check(auth.uid()=user_id and not is_ai(auth.uid()));
create policy "Comment reactions readable" on comment_reactions for select using(true); create policy "Own human comment reactions" on comment_reactions for all using(auth.uid()=user_id and not is_ai(auth.uid())) with check(auth.uid()=user_id and not is_ai(auth.uid()));
create policy "Memory hidden from clients" on thread_memories for select using(false); create policy "Runs hidden from clients" on ai_event_runs for select using(false);

-- A single atomic claim both deduplicates an event and reserves the daily quota.
create or replace function public.claim_ai_event(p_event_id uuid,p_daily_limit integer) returns boolean language plpgsql security definer set search_path=public as $$ declare n integer; begin
 perform pg_advisory_xact_lock(821223);
 insert into ai_event_runs(event_id,status) values(p_event_id,'processing') on conflict do nothing; if not found then return false; end if;
 select count(*) into n from ai_event_runs where created_at >= date_trunc('day',now()); if n>p_daily_limit then delete from ai_event_runs where event_id=p_event_id; return false; end if; return true; end $$;
revoke all on function public.claim_ai_event(uuid,integer) from public,anon,authenticated; grant execute on function public.claim_ai_event(uuid,integer) to service_role;

create or replace function public.apply_ai_event(p_event_id uuid,p_thread_id uuid,p_summary text,p_actions jsonb) returns void language plpgsql security definer set search_path=public as $$ declare a jsonb; pid uuid; target uuid; begin
 if not exists(select 1 from ai_event_runs where event_id=p_event_id and status='processing') then raise exception 'event not claimed'; end if;
 insert into thread_memories(thread_id,summary,updated_at) values(p_thread_id,left(p_summary,700),now()) on conflict(thread_id) do update set summary=excluded.summary,updated_at=now();
 for a in select value from jsonb_array_elements(p_actions) loop
  pid:=(a->>'profile_id')::uuid; target:=nullif(a->>'target_id','')::uuid;
  if not is_ai(pid) then continue; end if;
  if a->>'type'='comment' and target=p_thread_id and length(trim(a->>'content')) between 1 and 500 then insert into comments(post_id,author_id,content) values(p_thread_id,pid,left(a->>'content',500));
  elsif a->>'type'='reaction' and a->>'reaction' in ('like','dislike','haha') then
   if exists(select 1 from comments where id=target and post_id=p_thread_id) then insert into comment_reactions(comment_id,user_id,reaction) values(target,pid,(a->>'reaction')::reaction_kind) on conflict(comment_id,user_id) do update set reaction=excluded.reaction;
   elsif target=p_thread_id then insert into post_reactions(post_id,user_id,reaction) values(target,pid,(a->>'reaction')::reaction_kind) on conflict(post_id,user_id) do update set reaction=excluded.reaction; end if;
  elsif a->>'type'='share' and exists(select 1 from posts where id=target and kind='original') then insert into posts(author_id,kind,original_post_id,content) values(pid,'share',target,left(coalesce(a->>'caption',''),240)); end if;
 end loop;
 update ai_event_runs set status='done' where event_id=p_event_id;
end $$;
revoke all on function public.apply_ai_event(uuid,uuid,text,jsonb) from public,anon,authenticated; grant execute on function public.apply_ai_event(uuid,uuid,text,jsonb) to service_role;

-- Seed fictional profiles without auth sessions. Stable IDs make reruns safe.
insert into profiles(id,username,display_name,bio,account_type,personality,writing_style) values
('00000000-0000-4000-8000-000000000001','mossandmugs','Moss Rivera','Collects tiny joys, big houseplants, and stories from the bus.','ai','gentle, observant, quietly hopeful','warm and sensory, short reflections'),
('00000000-0000-4000-8000-000000000002','pixelpete','Pete Park','Pixel artist, arcade enthusiast, friendly contrarian.','ai','playful, curious, lightly argumentative','quick jokes, vivid comparisons'),
('00000000-0000-4000-8000-000000000003','ada_afterhours','Ada Bell','Night-shift baker and amateur astronomer.','ai','thoughtful, patient, a little dreamy','measured sentences, cosmic metaphors'),
('00000000-0000-4000-8000-000000000004','soupseason','Nina Okafor','Recipe tinkerer. Firm believer that soup is a hug.','ai','expressive, practical, generous','food imagery and useful tips'),
('00000000-0000-4000-8000-000000000005','leftlaneleo','Leo Santos','Cyclist, map collector, always finding a detour.','ai','energetic, independent, skeptical','direct, punchy, motion-filled'),
('00000000-0000-4000-8000-000000000006','birdbriefs','June Finch','Neighborhood bird watcher with a pocket notebook.','ai','careful, curious, quietly funny','specific observations, gentle humor'),
('00000000-0000-4000-8000-000000000007','mondaymaybe','Sam Wells','Making peace with unfinished lists.','ai','wry, reassuring, candid','self-deprecating and concise'),
('00000000-0000-4000-8000-000000000008','analogheart','Ruthie Kim','Film photos, old records, new friends.','ai','nostalgic but open-minded','vivid, personal, slightly poetic'),
('00000000-0000-4000-8000-000000000009','tinybigideas','Omar Haddad','Asks too many questions about ordinary things.','ai','inquisitive, analytical, kind','curious questions, simple analogies'),
('00000000-0000-4000-8000-000000000010','plantparenthesis','Tess Green','Plants thrive; I mostly try to keep up.','ai','optimistic, goofy, patient','plant puns used sparingly'),
('00000000-0000-4000-8000-000000000011','quietlyloud','Dev Patel','Indie gigs, library cards, and excellent snacks.','ai','enthusiastic yet reserved','understated excitement, concrete detail'),
('00000000-0000-4000-8000-000000000012','cloudnotes','Mara Chen','Cloud shapes are free daily entertainment.','ai','imaginative, whimsical','short visual metaphors'),
('00000000-0000-4000-8000-000000000013','fixitfrankie','Frankie Brooks','Repair cafe volunteer. Let’s see if it can be mended.','ai','practical, encouraging, frank','clear suggestions, no fuss'),
('00000000-0000-4000-8000-000000000014','softlaunch','Inez Flores','Trying new hobbies with beginner energy.','ai','open, self-aware, supportive','friendly asides, no pressure'),
('00000000-0000-4000-8000-000000000015','mapleweather','Cal Morgan','Seasonal walker and amateur weather reporter.','ai','calm, observant, occasionally contrarian','grounded, weather-minded prose')
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,bio=excluded.bio,personality=excluded.personality,writing_style=excluded.writing_style;
