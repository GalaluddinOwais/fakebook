'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { addComment, advancePostReactionCounts, react, sharePost } from '@/app/actions';
import { Avatar } from '@/components/avatar';
import { CommentThread } from '@/components/comment-thread';
import { PostMenu } from '@/components/post-menu';
import { SubmitButton } from '@/components/submit-button';

type Profile = { id: string; display_name: string; username: string; avatar_url?: string | null; account_type: 'human' | 'ai' };
type ReactionCounts = { likes: number; dislikes: number; haha: number };
type PostReaction = { reaction: string; user_id: string; created_at: string };
type CommentReaction = { reaction: string; user_id: string; created_at: string };
type FeedComment = {
  id: string;
  parent_comment_id: string | null;
  content: string;
  created_at: string;
  visible_at: string | null;
  author: Profile;
  comment_reactions?: CommentReaction[];
};
type FeedPost = {
  id: string;
  content: string;
  kind: 'original' | 'share';
  original_post_id: string | null;
  created_at: string;
  author: Profile;
  ai_likes_decided?: number;
  ai_dislikes_decided?: number;
  ai_haha_decided?: number;
  ai_likes_shown?: number;
  ai_dislikes_shown?: number;
  ai_haha_shown?: number;
  original?: { id: string; content: string; author: { display_name: string; username: string } };
  comments: FeedComment[];
  post_reactions: PostReaction[];
};

function ago(date: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
}

export function Feed({ posts, userId }: { posts: FeedPost[]; userId: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [aiCounts, setAiCounts] = useState<Record<string, ReactionCounts>>(() => Object.fromEntries(
    posts.map(post => [post.id, {
      likes: post.ai_likes_shown || 0,
      dislikes: post.ai_dislikes_shown || 0,
      haha: post.ai_haha_shown || 0,
    }]),
  ));

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    if (pendingAction) return;
    setPendingAction(key);
    try {
      await action();
    } finally {
      setPendingAction(null);
    }
  };

  useEffect(() => {
    setAiCounts(current => {
      const next = { ...current };
      for (const post of posts) {
        const saved = {
          likes: post.ai_likes_shown || 0,
          dislikes: post.ai_dislikes_shown || 0,
          haha: post.ai_haha_shown || 0,
        };
        const prior = next[post.id];
        next[post.id] = prior ? {
          likes: Math.max(prior.likes, saved.likes),
          dislikes: Math.max(prior.dislikes, saved.dislikes),
          haha: Math.max(prior.haha, saved.haha),
        } : saved;
      }
      return next;
    });
  }, [posts]);

  const batchKey = posts.filter(post => {
    const counts = aiCounts[post.id] || {
      likes: post.ai_likes_shown || 0,
      dislikes: post.ai_dislikes_shown || 0,
      haha: post.ai_haha_shown || 0,
    };
    return counts.likes < (post.ai_likes_decided || 0)
      || counts.dislikes < (post.ai_dislikes_decided || 0)
      || counts.haha < (post.ai_haha_decided || 0);
  }).map(post => post.id).join(',');

  const hasRecentHumanActivity = posts.some(post =>
    (post.author.account_type === 'human' && now - new Date(post.created_at).getTime() < 120_000)
    || post.comments?.some(comment => comment.author.account_type === 'human' && now - new Date(comment.created_at).getTime() < 120_000),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const ids = batchKey ? batchKey.split(',') : [];
    if (!ids.length) return;
    let active = true;
    const tick = async () => {
      const rows = await Promise.all(ids.map(async id => {
        try { return { id, counts: await advancePostReactionCounts(id) }; }
        catch { return null; }
      }));
      if (!active) return;
      setAiCounts(current => {
        const next = { ...current };
        for (const row of rows) {
          if (!row?.counts) continue;
          const prior = next[row.id] || { likes: 0, dislikes: 0, haha: 0 };
          next[row.id] = {
            likes: Math.max(prior.likes, Number(row.counts.likes) || 0),
            dislikes: Math.max(prior.dislikes, Number(row.counts.dislikes) || 0),
            haha: Math.max(prior.haha, Number(row.counts.haha) || 0),
          };
        }
        return next;
      });
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => { active = false; clearInterval(timer); };
  }, [batchKey]);

  useEffect(() => {
    if (!hasRecentHumanActivity) return;
    let ticks = 0;
    const timer = setInterval(() => {
      router.refresh();
      ticks += 1;
      if (ticks >= 60) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [hasRecentHumanActivity, router]);

  return <div className="posts">
    {posts.map(post => {
      const visibleReactions = post.post_reactions?.filter(reaction => new Date(reaction.created_at).getTime() <= now) || [];
      const visibleComments = post.comments?.filter(comment => new Date(comment.visible_at || comment.created_at).getTime() <= now) || [];
      const myReaction = visibleReactions.find(reaction => reaction.user_id === userId)?.reaction;
      const saved = aiCounts[post.id] || {
        likes: post.ai_likes_shown || 0,
        dislikes: post.ai_dislikes_shown || 0,
        haha: post.ai_haha_shown || 0,
      };
      const reactionCounts = {
        like: visibleReactions.filter(reaction => reaction.reaction === 'like').length + saved.likes,
        dislike: visibleReactions.filter(reaction => reaction.reaction === 'dislike').length + saved.dislikes,
        haha: visibleReactions.filter(reaction => reaction.reaction === 'haha').length + saved.haha,
      };

      return <article id={`post-${post.id}`} className="post-card" key={post.id}>
        <div className="post-head">
          <Link href={`/profile/${post.author.username}`}><Avatar profile={post.author}/></Link>
          <div className="author">
            <div><Link href={`/profile/${post.author.username}`} className="name">{post.author.display_name}</Link></div>
            <small>{ago(post.created_at)}{post.kind === 'share' && ' · shared'}</small>
          </div>
          <PostMenu postId={post.id} canDelete={userId === post.author.id}/>
        </div>

        {post.kind === 'share' && <p className="share-caption">{post.content || 'Shared a post'}</p>}
        <div className={post.kind === 'share' ? 'shared-box' : 'post-content'}>
          {post.kind === 'share' && post.original && <>
            <div className="shared-by">Originally by <Link href={`/profile/${post.original.author.username}`}>{post.original.author.display_name}</Link></div>
            <p>{post.original.content}</p>
          </>}
          {post.kind === 'original' && <p>{post.content}</p>}
        </div>

        <div className="post-stats">
          <span>♥ {reactionCounts.like} likes · {reactionCounts.dislike} dislikes · {reactionCounts.haha} haha</span>
          <button type="button" onClick={() => setExpanded(expanded === post.id ? null : post.id)}>{visibleComments.length} comments</button>
        </div>
        <div className="post-actions">
          <button className={myReaction === 'like' ? 'reaction-active' : ''} aria-pressed={myReaction === 'like'} disabled={pendingAction !== null} onClick={() => void runAction(`${post.id}:like`, () => react(post.id, 'like'))}>{pendingAction === `${post.id}:like` ? '... ' : ''}♡ <span>Like</span></button>
          <button className={myReaction === 'dislike' ? 'reaction-active' : ''} aria-pressed={myReaction === 'dislike'} disabled={pendingAction !== null} onClick={() => void runAction(`${post.id}:dislike`, () => react(post.id, 'dislike'))}>{pendingAction === `${post.id}:dislike` ? '... ' : ''}⊘ <span>Dislike</span></button>
          <button className={myReaction === 'haha' ? 'reaction-active' : ''} aria-pressed={myReaction === 'haha'} disabled={pendingAction !== null} onClick={() => void runAction(`${post.id}:haha`, () => react(post.id, 'haha'))}>{pendingAction === `${post.id}:haha` ? '... ' : ''}☺ <span>Haha</span></button>
          <button onClick={() => setExpanded(expanded === post.id ? null : post.id)}>▢ <span>Comment</span></button>
          {userId
            ? <details className="share-menu">
                <summary>↗ <span>Share</span></summary>
                <form action={sharePost}>
                  <input type="hidden" name="post_id" value={post.id}/>
                  <input name="content" placeholder="Add a thought (optional)" maxLength={240}/>
                  <SubmitButton className="button" pendingLabel="Sharing...">Share post</SubmitButton>
                </form>
              </details>
            : <Link className="share-login" href="/auth?mode=login">Log in to share</Link>}
        </div>

        {expanded === post.id && <div className="comments">
          <CommentThread comments={visibleComments} postId={post.id} userId={userId}/>
          {userId
            ? <form action={addComment} className="comment-form">
                <input type="hidden" name="post_id" value={post.id}/>
                <input name="content" placeholder="Write a comment…" maxLength={1000} required/>
                <SubmitButton pendingLabel="Sending...">↗</SubmitButton>
              </form>
            : <p className="login-prompt"><Link href="/auth?mode=login">Log in</Link> to join the conversation.</p>}
        </div>}
      </article>;
    })}
  </div>;
}
