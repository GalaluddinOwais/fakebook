'use client';

import { useState } from 'react';
import { deletePost } from '@/app/actions';
import { SubmitButton } from '@/components/submit-button';

export function PostMenu({ postId, canDelete }: { postId: string; canDelete: boolean }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyPostLink() {
    const url = new URL(window.location.href);
    url.hash = `post-${postId}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  return <details className="post-options">
    <summary aria-label="Post options" title="Post options">···</summary>
    <div className="post-options-menu">
      <button type="button" onClick={copyPostLink}>{copyStatus === 'copied' ? 'Link copied' : copyStatus === 'failed' ? 'Could not copy link' : 'Copy post link'}</button>
      {canDelete && <form action={deletePost}>
        <input type="hidden" name="post_id" value={postId}/>
        <SubmitButton className="post-option-delete">Delete post</SubmitButton>
      </form>}
    </div>
  </details>;
}
