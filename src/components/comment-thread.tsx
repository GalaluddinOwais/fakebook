'use client';

import { useState } from 'react';
import Link from 'next/link';
import { addComment, reactToComment } from '@/app/actions';
import { SubmitButton } from '@/components/submit-button';
import { Avatar } from '@/components/avatar';

type Comment = {
  id: string;
  parent_comment_id: string | null;
  content: string;
  created_at: string;
  comment_reactions?: { reaction: string; user_id: string; created_at: string }[];
  author: { id: string; display_name: string; username: string; avatar_url?: string | null; account_type: 'human' | 'ai' };
};

function ago(date: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

export function CommentThread({ comments, postId, userId }: { comments: Comment[]; postId: string; userId: string | null }) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [pendingReaction, setPendingReaction] = useState<string | null>(null);
  const byParent = new Map<string | null, Comment[]>();
  for (const comment of [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at))) byParent.set(comment.parent_comment_id, [...(byParent.get(comment.parent_comment_id) || []), comment]);

  function render(parentId: string | null, depth = 0): React.ReactNode {
    return (byParent.get(parentId) || []).map(comment => (
      <div className="comment-thread-item" key={comment.id} style={{ marginLeft: depth ? 20 : 0 }}>
        <div className="comment">
          <Avatar profile={comment.author}/>
          <div className="comment-content">
            <div className="comment-bubble">
              <div className="comment-name"><Link href={`/profile/${comment.author.username}`}>{comment.author.display_name}</Link><small>{ago(comment.created_at)}</small></div>
              <p>{comment.content}</p>
            </div>
            {userId && <button className="comment-reply-button" type="button" aria-expanded={replyingTo === comment.id} aria-controls={`reply-form-${comment.id}`} onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}>↩ Reply</button>}
          </div>
        </div>
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
            >{pendingReaction === key ? '… ' : ''}{reactionLabel(reaction)} {count > 0 ? count : ''}</button>;
          })}
        </div>
        {replyingTo === comment.id && userId && <form id={`reply-form-${comment.id}`} action={addComment} className="comment-form reply-form"><input type="hidden" name="post_id" value={postId}/><input type="hidden" name="parent_comment_id" value={comment.id}/><input name="content" placeholder={`Reply to ${comment.author.display_name}…`} maxLength={1000} required autoFocus/><SubmitButton className="reply-submit" pendingLabel="Sending...">Send reply</SubmitButton></form>}
        {depth < 8 && render(comment.id, depth + 1)}
      </div>
    ));
  }

  return <div className="comment-list">{render(null)}</div>;
}

function reactionLabel(reaction: 'like' | 'dislike' | 'haha') {
  return reaction === 'like' ? 'Like' : reaction === 'dislike' ? 'Dislike' : 'Haha';
}
