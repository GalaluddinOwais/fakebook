'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { admin } from '@/lib/supabase/admin';
import { runFakebookAIForHumanEvent, runFakebookAIForCommentReply } from '@/lib/ai';

async function human() { const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) throw new Error('Please log in first.'); return { db, user }; }
export async function advancePostReactionCounts(postIds: string[] | string) {
  const legacySinglePostCall = typeof postIds === 'string';
  const requestedIds = legacySinglePostCall ? [postIds] : Array.isArray(postIds) ? postIds : [];
  if (requestedIds.length > 30) return [];
  const validIds = requestedIds.filter(id => /^[0-9a-f-]{36}$/i.test(id));
  if (!validIds.length) return [];
  const db = admin();
  const results = await Promise.all(validIds.map(async postId => {
    const { data, error } = await db.rpc('advance_post_ai_reactions', { p_post_id: postId });
    if (error) throw new Error(`Could not advance post reactions: ${error.message}`);
    return { id: postId, counts: Array.isArray(data) ? data[0] || null : data };
  }));
  return legacySinglePostCall ? results[0]?.counts || null : results;
}
export async function fetchAIComments(postIds: string[]) {
  if (!Array.isArray(postIds) || postIds.length > 30 || postIds.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return [];
  if (!postIds.length) return [];
  const db = await createClient();
  const { data, error } = await db.from('comments')
    .select('id,post_id,parent_comment_id,content,created_at,visible_at,author:profiles!comments_author_id_fkey(id,display_name,username,avatar_url,account_type),comment_reactions(reaction,user_id,created_at)')
    .in('post_id', postIds)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw new Error(`Could not refresh AI comments: ${error.message}`);
  return (data || []).filter(comment => {
    const author = Array.isArray(comment.author) ? comment.author[0] : comment.author;
    return author?.account_type === 'ai';
  });
}
export async function createPost(form: FormData) {
  const { db, user } = await human(); const content = String(form.get('content') || '').trim(); if (!content || content.length > 2000) throw new Error('Post must be 1–2000 characters.');
  const { data, error } = await db.from('posts').insert({ author_id: user.id, content, kind: 'original' }).select('id').single(); if (error) throw error;
  after(async () => { await runFakebookAIForHumanEvent({ id: data.id, post_id: data.id, author_id: user.id, content }); revalidatePath('/'); }); revalidatePath('/');
}
export async function sharePost(form: FormData) {
  const { db, user } = await human();
  const source_post_id = String(form.get('post_id') || '');
  const content = String(form.get('content') || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(source_post_id)) throw new Error('Invalid post ID.');
  if (content.length > 240) throw new Error('Share text must be 240 characters or fewer.');

  const { data: source, error: sourceError } = await db.from('posts')
    .select('id,kind,original_post_id')
    .eq('id', source_post_id)
    .maybeSingle();
  if (sourceError || !source) throw new Error('The post you are sharing could not be found.');
  // Keep the exact post that was shared. This allows a share to quote another share.
  const original_post_id = source.id;
  const { data: share, error } = await db.from('posts')
    .insert({ author_id: user.id, kind: 'share', original_post_id, content })
    .select('id')
    .single();
  if (error) throw error;

  after(async () => {
    await runFakebookAIForHumanEvent({
      id: share.id,
      post_id: share.id,
      author_id: user.id,
      content: content || 'Shared a post',
    });
    revalidatePath('/', 'layout');
  });
  revalidatePath('/', 'layout');
}
export async function addComment(form: FormData) {
  const { db, user } = await human();
  const post_id = String(form.get('post_id') || '');
  const parent_comment_id = String(form.get('parent_comment_id') || '') || null;
  const content = String(form.get('content') || '').trim();
  if (!post_id || !content || content.length > 1000) throw new Error('Comment must be 1-1000 characters.');
  let replyingToAI = false;
  if (parent_comment_id) {
    const { data: parent, error: parentError } = await db.from('comments').select('id,author_id').eq('id', parent_comment_id).eq('post_id', post_id).maybeSingle();
    if (parentError || !parent) throw new Error('The comment you are replying to could not be found.');
    const { data: parentAuthor, error: authorError } = await db.from('profiles').select('account_type').eq('id', parent.author_id).maybeSingle();
    if (authorError) throw authorError;
    replyingToAI = parentAuthor?.account_type === 'ai';
  }
  const { data, error } = await db.from('comments').insert({ post_id, author_id: user.id, parent_comment_id, content })
    .select('id,post_id,parent_comment_id,content,created_at,visible_at,author:profiles!comments_author_id_fkey(id,display_name,username,avatar_url,account_type),comment_reactions(reaction,user_id,created_at)')
    .single();
  if (error) throw error;
  revalidatePath('/', 'layout');
  const shouldTriggerAI = !parent_comment_id || replyingToAI;
  return { comment: data, shouldTriggerAI, aiTargetId: shouldTriggerAI ? data.id : null };
}
export async function triggerCommentAI(postId: string, commentId: string) {
  const { db, user } = await human();
  const { data: comment, error } = await db.from('comments')
    .select('id,post_id,parent_comment_id,content,author_id')
    .eq('id', commentId)
    .eq('post_id', postId)
    .eq('author_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!comment) throw new Error('The comment could not be found.');
  let shouldTrigger = comment.parent_comment_id === null;
  if (comment.parent_comment_id) {
    const { data: parent, error: parentError } = await db.from('comments')
      .select('author:profiles!comments_author_id_fkey(account_type)')
      .eq('id', comment.parent_comment_id)
      .maybeSingle();
    if (parentError) throw parentError;
    const parentAuthor = Array.isArray(parent?.author) ? parent.author[0] : parent?.author;
    shouldTrigger = parentAuthor?.account_type === 'ai';
  }
  if (!shouldTrigger) return;
  return runFakebookAIForCommentReply({ post_id: postId, comment_id: comment.id, content: comment.content });
}
export async function react(target: string, reaction: 'like'|'dislike'|'haha') {
  const { db, user } = await human();
  const { data: prior } = await db.from('post_reactions').select('id,reaction').eq('post_id', target).eq('user_id', user.id).maybeSingle();
  const result = prior?.reaction === reaction ? await db.from('post_reactions').delete().eq('id', prior.id) : await db.from('post_reactions').upsert({ post_id: target, user_id: user.id, reaction }, { onConflict: 'post_id,user_id' });
  if (result.error) throw result.error;
  revalidatePath('/');
}
export async function reactToComment(commentId: string, reaction: 'like'|'dislike'|'haha') {
  const { db, user } = await human();
  if (!/^[0-9a-f-]{36}$/i.test(commentId)) throw new Error('Invalid comment ID.');
  if (!['like', 'dislike', 'haha'].includes(reaction)) throw new Error('Invalid reaction.');
  const { data: prior, error: priorError } = await db.from('comment_reactions')
    .select('id,reaction')
    .eq('comment_id', commentId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (priorError) throw priorError;
  const result = prior?.reaction === reaction
    ? await db.from('comment_reactions').delete().eq('id', prior.id)
    : await db.from('comment_reactions').upsert(
        { comment_id: commentId, user_id: user.id, reaction },
        { onConflict: 'comment_id,user_id' },
      );
  if (result.error) throw result.error;
  revalidatePath('/', 'layout');
}
export async function deletePost(form: FormData) {
  const { db,user } = await human(); const post_id = String(form.get('post_id') || '');
  if (!post_id) throw new Error('Post ID is required.');
  const { error } = await db.from('posts').delete().eq('id',post_id).eq('author_id',user.id);
  if (error) throw error;
  revalidatePath('/', 'layout');
}
export async function updateProfile(form: FormData) {
  const { db,user } = await human(); const display_name=String(form.get('display_name')||'').trim(); const bio=String(form.get('bio')||'').slice(0,240); const avatar_url=String(form.get('avatar_url')||'').trim()||null;
  const { error }=await db.from('profiles').update({display_name,bio,avatar_url}).eq('id',user.id); if(error) throw error; revalidatePath('/');
}
