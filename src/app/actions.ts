'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { admin } from '@/lib/supabase/admin';
import { runFakebookAIForHumanEvent, runFakebookAIForCommentReply } from '@/lib/ai';

async function human() { const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) throw new Error('Please log in first.'); return { db, user }; }
export async function advancePostReactionCounts(postId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new Error('Invalid post ID.');
  const { data, error } = await admin().rpc('advance_post_ai_reactions', { p_post_id: postId });
  if (error) throw new Error(`Could not advance post reactions: ${error.message}`);
  return Array.isArray(data) ? data[0] || null : data;
}
export async function createPost(form: FormData) {
  const { db, user } = await human(); const content = String(form.get('content') || '').trim(); if (!content || content.length > 2000) throw new Error('Post must be 1–2000 characters.');
  const { data, error } = await db.from('posts').insert({ author_id: user.id, content, kind: 'original' }).select('id').single(); if (error) throw error;
  after(async () => { await runFakebookAIForHumanEvent({ id: data.id, post_id: data.id, author_id: user.id, content }); revalidatePath('/'); }); revalidatePath('/');
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
  const { data, error } = await db.from('comments').insert({ post_id, author_id: user.id, parent_comment_id, content }).select('id').single();
  if (error) throw error;
  if (parent_comment_id && replyingToAI) after(async () => {
    await runFakebookAIForCommentReply({ post_id, comment_id: parent_comment_id, content });
    revalidatePath('/', 'layout');
  });
  revalidatePath('/', 'layout');
}
export async function react(target: string, reaction: 'like'|'dislike'|'haha') {
  const { db, user } = await human();
  const { data: prior } = await db.from('post_reactions').select('id,reaction').eq('post_id', target).eq('user_id', user.id).maybeSingle();
  const result = prior?.reaction === reaction ? await db.from('post_reactions').delete().eq('id', prior.id) : await db.from('post_reactions').upsert({ post_id: target, user_id: user.id, reaction }, { onConflict: 'post_id,user_id' });
  if (result.error) throw result.error;
  revalidatePath('/');
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
