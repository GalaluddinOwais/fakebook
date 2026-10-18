'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { addComment, reactToComment, triggerCommentAI } from '@/app/actions';
import { Avatar } from '@/components/avatar';

type Comment = {
  id: string;
  parent_comment_id: string | null;
  content: string;
  created_at: string;
  visible_at?: string | null;
  comment_reactions?: { reaction: string; user_id: string; created_at: string }[];
  author: { id: string; display_name: string; username?: string | null; avatar_url?: string | null; account_type: 'human' | 'ai' };
};

function ago(date: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

export function CommentThread({ comments, postId, userId }: { comments: Comment[]; postId: string; userId: string | null }) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [pendingReaction, setPendingReaction] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [confirmedComments, setConfirmedComments] = useState<Comment[]>([]);
  useEffect(() => {
    const serverIds = new Set(comments.map(comment => comment.id));
    if (serverIds.size) setConfirmedComments(current => current.filter(comment => !serverIds.has(comment.id)));
  }, [comments]);
  async function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingComment) return;
    const form = event.currentTarget;
    setSubmittingComment(true);
    try {
      const { comment, shouldTriggerAI } = await addComment(new FormData(form));
      const author = Array.isArray(comment.author) ? comment.author[0] : comment.author;
      setConfirmedComments(current => current.some(item => item.id === comment.id)
        ? current
        : [...current, { ...comment, author } as Comment]);
      form.reset();
      if (shouldTriggerAI) void triggerCommentAI(postId, comment.id).catch(error => {
        console.error('Could not trigger AI comment follow-up:', error);
      });
    } catch (error) {
      console.error('Could not save comment:', error);
    } finally {
      setSubmittingComment(false);
    }
  }
  const visibleComments = [...comments, ...confirmedComments.filter(saved => !comments.some(comment => comment.id === saved.id))];
  const byParent = new Map<string | null, Comment[]>();
  for (const comment of [...visibleComments].sort((a, b) => a.created_at.localeCompare(b.created_at))) byParent.set(comment.parent_comment_id, [...(byParent.get(comment.parent_comment_id) || []), comment]);

  function render(parentId: string | null, depth = 0): React.ReactNode {
    return (byParent.get(parentId) || []).map(comment => (
      <div className="comment-thread-item" key={comment.id} style={{ marginLeft: depth ? 20 : 0 }}>
        <div className="comment">
          <Avatar profile={comment.author}/>
          <div className="comment-content">
            <div className="comment-bubble">
              <div className="comment-name">{comment.author.username
                ? <Link href={`/profile/${comment.author.username}`}>{comment.author.display_name}</Link>
                : <span>{comment.author.display_name || 'Neighbor'}</span>}<small>{ago(comment.created_at)}</small></div>
              <p>{comment.content}</p>
              <div className="comment-reactions" aria-label="Comment reactions">
                {(['like', 'dislike', 'haha'] as const).map(reaction => {
                  const count = comment.comment_reactions?.filter(item => item.reaction === reaction).length || 0;
                  const active = comment.comment_reactions?.some(item => item.user_id === userId && item.reaction === reaction) || false;
                  if (!userId && count === 0) return null;
                  if (!userId) return <span className="comment-reaction-count" key={reaction}>{reactionLabel(reaction)} {count}</span>;
                  const key = `${comment.id}:${reaction}`;
                  return <button
                    className={`comment-react${active ? ' comment-reaction-active' : ''}`}
                    type="button"
                    key={reaction}
                    aria-pressed={active}
                    disabled={pendingReaction !== null}
                    onClick={async () => {
                      if (pendingReaction) return;
                      setPendingReaction(key);
                      try { await reactToComment(comment.id, reaction); }
                      finally { setPendingReaction(null); }
                    }}
                  >{reactionLabel(reaction)} {count > 0 ? count : ''}</button>;
                })}
              </div>
            </div>
          </div>
        </div>
        {userId && <button className="comment-reply-button" type="button" aria-expanded={replyingTo === comment.id} aria-controls={`reply-form-${comment.id}`} onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}>Reply</button>}
        {replyingTo === comment.id && userId && <form id={`reply-form-${comment.id}`} onSubmit={submitComment} className="comment-form reply-form"><input type="hidden" name="post_id" value={postId}/><input type="hidden" name="parent_comment_id" value={comment.id}/><input name="content" placeholder={`Reply to ${comment.author.display_name}`} maxLength={1000} required autoFocus/><button className="reply-submit" type="submit" disabled={submittingComment}>{submittingComment ? 'Sending...' : 'Send reply'}</button></form>}
        {depth < 8 && render(comment.id, depth + 1)}
      </div>
    ));
  }

  return <div className="comment-list">
    {render(null)}
    {userId
      ? <form onSubmit={submitComment} className="comment-form">
          <input type="hidden" name="post_id" value={postId}/>
          <input name="content" placeholder="Write a comment..." maxLength={1000} required/>
          <button type="submit" disabled={submittingComment}>{submittingComment ? 'Sending...' : 'Send'}</button>
        </form>
      : <p className="login-prompt"><Link href="/auth?mode=login">Log in</Link> to join the conversation.</p>}
  </div>;
}

function reactionLabel(reaction: 'like' | 'dislike' | 'haha') {
  return reaction === 'like' ? 'Like' : reaction === 'dislike' ? 'Dislike' : 'Haha';
}
