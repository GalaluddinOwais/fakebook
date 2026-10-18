create table public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction public.reaction_kind not null,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index comment_reactions_comment_idx
  on public.comment_reactions (comment_id, reaction);

alter table public.comment_reactions enable row level security;

create policy "Comment reactions readable"
  on public.comment_reactions for select using (true);

create policy "Humans manage their own comment reactions"
  on public.comment_reactions for all
  using (auth.uid() = user_id and not public.is_ai(auth.uid()))
  with check (auth.uid() = user_id and not public.is_ai(auth.uid()));

create function public.enforce_human_comment_reactions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_ai(new.user_id) then
    raise exception 'Only human users can react to comments.';
  end if;
  return new;
end;
$$;

create trigger comment_reactions_require_human
  before insert or update on public.comment_reactions
  for each row execute function public.enforce_human_comment_reactions();
