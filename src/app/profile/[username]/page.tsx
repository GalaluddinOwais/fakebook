import Link from 'next/link';
import { Avatar } from '@/components/avatar';
import { Feed } from '@/components/feed';
import { createClient } from '@/lib/supabase/server';

const postSelection = '*,author:profiles!posts_author_id_fkey(id,display_name,username,avatar_url,account_type),original:posts!original_post_id(id,content,author:profiles!posts_author_id_fkey(display_name,username)),comments(id,parent_comment_id,content,created_at,visible_at,author:profiles!comments_author_id_fkey(id,display_name,username,avatar_url,account_type),comment_reactions(reaction,user_id,created_at)),post_reactions(reaction,user_id,created_at)';

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const db = await createClient();
  const [{ data: profile }, { data: { user } }] = await Promise.all([
    db.from('profiles')
      .select('id,username,display_name,bio,avatar_url,account_type,created_at')
      .eq('username', username)
      .eq('account_type', 'human')
      .maybeSingle(),
    db.auth.getUser(),
  ]);

  const { data: posts, count: postCount } = profile
    ? await db.from('posts')
        .select(postSelection, { count: 'exact' })
        .eq('author_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(30)
    : { data: null, count: null };

  if (!profile) {
    return <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">fakebook<span>✳</span></Link>
        <Link className="quiet" href="/">← Feed</Link>
      </header>
      <div className="state"><h2>Profile not found</h2><Link href="/">Back to the neighborhood</Link></div>
    </main>;
  }

  const isOwnProfile = user?.id === profile.id;
  const joined = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(profile.created_at));

  return <main className="shell">
    <header className="topbar">
      <Link className="brand" href="/">fakebook<span>✳</span></Link>
      <div className="top-actions">
        {isOwnProfile && <span className="profile-owner-label">Your profile</span>}
        <Link className="quiet" href="/">← Feed</Link>
      </div>
    </header>

    <section className="profile-hero">
      <Avatar profile={profile}/>
      <div className="profile-details">
        <p className="eyebrow">NEIGHBOR PROFILE</p>
        <h1>{profile.display_name}</h1>
        {profile.bio
          ? <p className="profile-bio">{profile.bio}</p>
          : <p className="profile-bio muted">No bio added yet.</p>}
        <div className="profile-meta">
          <span>Member since {joined}</span>
          {isOwnProfile && user?.email && <span>{user.email}</span>}
        </div>
        {isOwnProfile && <Link className="profile-edit-link" href="/#edit-profile">Edit profile</Link>}
      </div>
    </section>

    <section className="profile-posts">
      <div className="section-title">
        <div><p className="eyebrow">THEIR MOMENTS</p><h2>Posts by {profile.display_name}</h2></div>
        <span className="profile-post-count">{postCount ?? 0}</span>
      </div>
      {posts?.length
        ? <Feed posts={posts} userId={user?.id ?? null}/>
        : <div className="state"><h3>No posts yet</h3><p>When {isOwnProfile ? 'you share something' : `${profile.display_name} shares something`}, it will appear here.</p></div>}
    </section>
  </main>;
}
