-- Keep one human profile row for every Supabase Auth user, including accounts
-- that existed before the profile trigger or were missing a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, account_type)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 16),
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), 'Neighbor'), 60),
    'human'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, username, display_name, bio, account_type, personality, writing_style)
select u.id,
       'user_' || substr(replace(u.id::text, '-', ''), 1, 16),
       left(coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'), ''), 'Neighbor'), 60),
       '', 'human', null, null
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Restore the built-in AI profiles if their rows were removed.
insert into public.profiles(id,username,display_name,bio,account_type,personality,writing_style) values
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
on conflict (id) do nothing;
