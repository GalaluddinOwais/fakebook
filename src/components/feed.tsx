'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { addComment, advancePostReactionCounts, react, sharePost } from '@/app/actions';
import { Avatar } from '@/components/avatar';
import { CommentThread } from '@/components/comment-thread';
import { PostMenu } from '@/components/post-menu';
import { SubmitButton } from '@/components/submit-button';

type Profile = { id: string; display_name: string; username?: string | null; avatar_url?: string | null; account_type: 'human' | 'ai' };
type Relation<T> = T | T[] | null | undefined;
type ReactionCounts = { likes: number; dislikes: number; haha: number };
type PostReaction = { reaction: string; user_id: string; created_at: string };
type CommentReaction = { reaction: string; user_id: string; created_at: string };
type FeedComment = {
  id: string;
  parent_comment_id: string | null;
  content: string;
  created_at: string;
  visible_at: string | null;
  author: Relation<Profile>;
  comment_reactions?: CommentReaction[];
};
type FeedPost = {
  id: string;
  author_id: string;
  content: string;
  kind: 'original' | 'share';
  original_post_id: string | null;
  created_at: string;
  author: Relation<Profile>;
  ai_likes_decided?: number;
  ai_dislikes_decided?: number;
  ai_haha_decided?: number;
  ai_likes_shown?: number;
  ai_dislikes_shown?: number;
  ai_haha_shown?: number;
  ai_reactions_reveal_steps?: number;
  original?: Relation<{ id: string; content: string; kind: 'original' | 'share'; created_at: string; author: Relation<{ display_name: string; username?: string | null }>; original?: Relation<{ id: string; content: string; kind: 'original' | 'share'; created_at: string; author: Relation<{ display_name: string; username?: string | null }> }> }>;
  comments: FeedComment[];
  post_reactions: PostReaction[];
};

function ago(date: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
}

function one<T>(value: Relation<T>): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function fallbackProfile(id = ''): Profile {
  return { id, display_name: 'Neighbor', username: null, account_type: 'human' };
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

  const waitingForAIContent = posts.some(post => {
    const recentHumanPost = one(post.author)?.account_type === 'human'
      && now - new Date(post.created_at).getTime() < 120_000;
    const aiTopLevelComments = post.comments?.filter(comment =>
      comment.parent_comment_id === null && one(comment.author)?.account_type === 'ai',
    ) || [];
    const expectedAIComments = post.ai_reactions_reveal_steps ?? 10;
    if (recentHumanPost && aiTopLevelComments.length < expectedAIComments) return true;

    const commentsById = new Map((post.comments || []).map(comment => [comment.id, comment]));
    return (post.comments || []).some(comment => {
      if (one(comment.author)?.account_type !== 'human' || now - new Date(comment.created_at).getTime() >= 120_000) return false;
      const parent = comment.parent_comment_id ? commentsById.get(comment.parent_comment_id) : null;
      const responseParentId = comment.parent_comment_id && one(parent?.author)?.account_type === 'ai'
        ? comment.parent_comment_id
        : comment.parent_comment_id ? null : comment.id;
      if (!responseParentId) return false;
      return !(post.comments || []).some(reply =>
        reply.parent_comment_id === responseParentId
        && one(reply.author)?.account_type === 'ai'
        && new Date(reply.created_at).getTime() > new Date(comment.created_at).getTime(),
      );
    });
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const ids = batchKey ? batchKey.split(',') : [];
    if (!ids.length) return;
    let active = true;
    const tick = async () => {
      let rows;
      try { rows = await advancePostReactionCounts(ids); }
      catch { return; }
      if (!active) return;
      if (!Array.isArray(rows)) rows = rows ? [{ id: ids[0], counts: rows }] : [];
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
    const timer = setInterval(() => void tick(), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [batchKey]);

  useEffect(() => {
    if (!waitingForAIContent) return;
    let ticks = 0;
    const timer = setInterval(() => {
      router.refresh();
      ticks += 1;
      if (ticks >= 60) clearInterval(timer);
    }, 60_000);
    return () => clearInterval(timer);
  }, [waitingForAIContent, router]);

  return <div className="posts">
    {posts.map(post => {
      const visibleReactions = post.post_reactions?.filter(reaction => new Date(reaction.created_at).getTime() <= now) || [];
      const visibleComments = post.comments?.filter(comment => new Date(comment.visible_at || comment.created_at).getTime() <= now) || [];
      const postAuthor = one(post.author) || fallbackProfile(post.author_id);
      const original = one(post.original);
      const originalAuthor = one(original?.author);
      const nestedOriginal = one(original?.original);
      const nestedAuthor = one(nestedOriginal?.author);
      const threadComments = visibleComments.map(comment => ({
        ...comment,
        author: one(comment.author) || fallbackProfile(),
      }));
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
          {postAuthor.username
            ? <Link href={`/profile/${postAuthor.username}`}><Avatar profile={postAuthor}/></Link>
            : <Avatar profile={postAuthor}/>}
          <div className="author">
            <div>{postAuthor.username
              ? <Link href={`/profile/${postAuthor.username}`} className="name">{postAuthor.display_name}</Link>
              : <span className="name">{postAuthor.display_name}</span>}</div>
            <small>{ago(post.created_at)}{post.kind === 'share' && ' · shared'}</small>
          </div>
          <PostMenu postId={post.id} canDelete={!!userId && userId === postAuthor.id}/>
        </div>

        {post.kind === 'share' && <p className="share-caption">{post.content || 'Shared a post'}</p>}
        <div className={post.kind === 'share' ? `shared-box${original?.kind === 'share' ? ' nested-share' : ''}` : 'post-content'}>
          {post.kind === 'share' && original && <>
            <div className="shared-by">{original.kind === 'share' ? 'Shared by ' : 'Originally by '}{originalAuthor?.username
              ? <Link href={`/profile/${originalAuthor.username}`}>{originalAuthor.display_name}</Link>
              : originalAuthor?.display_name || 'a neighbor'}{original.kind === 'share' && <small> · {ago(original.created_at)}</small>}</div>
            <p>{original.kind === 'share' ? original.content || 'Shared a post' : original.content}</p>
            {original.kind === 'share' && nestedOriginal && <div className="shared-box nested-original">
              <div className="shared-by">Originally by {nestedAuthor?.username
                ? <Link href={`/profile/${nestedAuthor.username}`}>{nestedAuthor.display_name}</Link>
                : nestedAuthor?.display_name || 'a neighbor'}</div>
              <p>{nestedOriginal.content}</p>
            </div>}
          </>}
          {post.kind === 'share' && !original && <p>This shared post is no longer available.</p>}
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
          <CommentThread comments={threadComments} postId={post.id} userId={userId}/>
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
