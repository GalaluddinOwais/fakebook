import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { admin } from '@/lib/supabase/admin';

interface AIProvider { generateStructuredJSON(prompt: string): Promise<string> }
function singleRelation<T>(relation: T | T[] | null | undefined): T | undefined {
  return Array.isArray(relation) ? relation[0] : relation ?? undefined;
}
export async function retryGeminiUnavailable<T>(request: () => Promise<T>, pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let retry = 0; ; retry++) {
    try { return await request(); }
    catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: number }).status : undefined;
      if (status !== 503 || retry >= 2) throw error;
      await pause(500 * (2 ** retry) + Math.floor(Math.random() * 250));
    }
  }
}
class GeminiProvider implements AIProvider {
  async generateStructuredJSON(prompt: string) {
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = client.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 5000, temperature: 0.8 } });
    return retryGeminiUnavailable(async () => {
      const response = await model.generateContent(prompt);
      return response.response.text();
    });
  }
}

const Output = z.object({ thread_summary: z.string().max(600).default('').refine(value => value.trim().split(/\s+/).filter(Boolean).length <= 80), actions: z.array(z.object({
  profile_id: z.string().uuid(), type: z.enum(['comment','reaction','share']),
  content: z.string().max(500).optional(), target_id: z.string().uuid().optional(), reaction: z.enum(['like','dislike','haha']).optional(), caption: z.string().max(240).optional(),
})).max(15) });
const BatchOutput = z.object({
  thread_summary: z.string().max(600).default(''),
  likes: z.number().int().min(0).max(10_000),
  dislikes: z.number().int().min(0).max(10_000),
  haha: z.number().int().min(0).max(10_000),
  comments: z.array(z.string().trim().min(1).max(500)).max(20),
});
export function validateAIOutput(raw: unknown, profileIds: string[], postIds: string[], commentIds: string[], threadId: string) {
  const parsed = Output.safeParse(raw);
  if (!parsed.success) return null;
  const profiles = new Set(profileIds);
  void postIds;
  void commentIds;
  const usedProfiles = new Set<string>();
  const actions = parsed.data.actions.filter(a => {
    if (!profiles.has(a.profile_id) || usedProfiles.has(a.profile_id)) return false;
    const valid = a.type === 'comment' ? !!a.content?.trim() && a.target_id === threadId :
      a.type === 'reaction' ? !!a.target_id && a.target_id === threadId && !!a.reaction : false;
    if (valid) usedProfiles.add(a.profile_id);
    return valid;
  });
  return { thread_summary: parsed.data.thread_summary, actions };
}
type Event = { id: string; post_id: string; author_id: string; content: string };

/** One provider response creates a full post batch, which one RPC applies. */
export async function runFakebookAIForHumanEvent(event: Event) {
  if (process.env.AI_ENABLED === 'false' || !process.env.GEMINI_API_KEY) return;
  const db = admin();
  const { data: claim, error: claimError } = await db.rpc('claim_ai_event', { p_event_id: event.id, p_daily_limit: Number(process.env.AI_MAX_REQUESTS_PER_DAY || 50) });
  if (claimError || claim !== true) return;
  try {
    const [{ data: post }, { data: profiles }, { data: comments }, { data: memory }] = await Promise.all([
      db.from('posts').select('id,content,created_at,kind,original_post_id,author:profiles(display_name,username)').eq('id', event.post_id).single(),
      db.from('profiles').select('id,display_name,username,bio,personality,writing_style').eq('account_type','ai').limit(15),
      db.from('comments').select('id,content,author:profiles(display_name,username,account_type)').eq('post_id', event.post_id).order('created_at',{ascending:false}).limit(Math.max(1,Math.min(6,Number(process.env.AI_MAX_RECENT_COMMENTS||6)))),
      db.from('thread_memories').select('summary').eq('thread_id', event.post_id).maybeSingle(),
    ]);
    const shareAuthor = singleRelation(post?.author);
    const { data: sharedPost } = post?.kind === 'share' && post.original_post_id
      ? await db.from('posts').select('id,content,kind,original_post_id,author:profiles(display_name,username)').eq('id', post.original_post_id).maybeSingle()
      : { data: null };
    const sharedAuthor = singleRelation(sharedPost?.author);
    const { data: sharedPostOriginal } = sharedPost?.kind === 'share' && sharedPost.original_post_id
      ? await db.from('posts').select('content,author:profiles(display_name,username)').eq('id', sharedPost.original_post_id).maybeSingle()
      : { data: null };
    const sharedOriginalAuthor = singleRelation(sharedPostOriginal?.author);
    const contextParts: string[] = [];
    if (post?.kind === 'share') contextParts.push(`Newest share by ${shareAuthor?.display_name || 'a neighbor'}: ${post.content || '(no caption)'}`);
    if (sharedPost) contextParts.push(`${sharedPost.kind === 'share' ? 'Shared post' : 'Original post'} by ${sharedAuthor?.display_name || 'a neighbor'}: ${sharedPost.content || '(no caption)'}`);
    if (sharedPost?.kind === 'share') contextParts.push(`Original post by ${sharedOriginalAuthor?.display_name || 'a neighbor'}: ${sharedPostOriginal?.content || '(unavailable)'}`);
    const postText = post?.kind === 'share' ? contextParts.join('\n') : post?.content || event.content;
    const prompt = `Decide how this new post should get reactions and comments. Return only this JSON shape: {"thread_summary":"short memory","likes":0,"dislikes":0,"haha":0,"comments":["comment text"]}. Choose each reaction count independently from 0 to 10000. Generate 5 to 20 comments when the post supports it, use fewer only when needed, and never exceed 20. Keep each comment concise and use distinct voices. Make at least one total action. Do not include profile IDs or action objects; the app assigns fictional AI profiles.\nPost: ${postText}\nRecent comments: ${JSON.stringify(comments)}\nShared thread memory: ${memory?.summary || ''}`;
    const provider: AIProvider = new GeminiProvider();
    const parsed = BatchOutput.safeParse(JSON.parse(await provider.generateStructuredJSON(prompt)));
    if (!parsed.success) throw new Error(`Invalid AI batch: ${parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; ')}`);
    const plan = parsed.data;
    const profilesToUse = profiles || [];
    const { error: revealPlanError } = await db.from('posts').update({ ai_reactions_reveal_steps: Math.max(1, plan.comments.length) }).eq('id', event.post_id);
    if (revealPlanError) throw new Error(`Could not save AI reveal schedule: ${revealPlanError.message}`);
    const actions: Array<Record<string, string>> = [];
    const reactionCounts = { likes: plan.likes, dislikes: plan.dislikes, haha: plan.haha };
    if (reactionCounts.likes + reactionCounts.dislikes + reactionCounts.haha === 0 && (plan.comments.length === 0 || profilesToUse.length === 0)) reactionCounts.likes = 1;
    if (reactionCounts.likes + reactionCounts.dislikes + reactionCounts.haha > 0) {
      actions.push({ type: 'reaction_batch', ...Object.fromEntries(Object.entries(reactionCounts).map(([key,value])=>[key,String(value)])), interval_ms: '60000' });
    }
    const { error: applyError } = await db.rpc('apply_ai_event', { p_event_id: event.id, p_thread_id: event.post_id, p_summary: plan.thread_summary, p_actions: actions });
    if (applyError) throw new Error(`Supabase apply_ai_event failed (${applyError.code || 'no code'}): ${applyError.message}${applyError.details ? `; ${applyError.details}` : ''}`);
    if (plan.comments.length && profilesToUse.length) {
      const intervalMs = 60_000;
      const postCreatedAt = new Date(post?.created_at || Date.now()).getTime();
      const scheduledComments = plan.comments.map((content, index) => ({ post_id: event.post_id, author_id: profilesToUse[index % profilesToUse.length].id, content, visible_at: new Date(postCreatedAt + (index + 1) * intervalMs).toISOString() }));
      const { error: commentsError } = await db.from('comments').insert(scheduledComments);
      if (commentsError) throw new Error(`Could not schedule AI comments: ${commentsError.message}`);
    }
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: number }).status : undefined;
    const message = error instanceof Error ? error.message : String(error);
    console.error(status ? `Fakebook AI provider failed (HTTP ${status}): ${message}` : `Fakebook AI batch failed: ${message}`);
    await db.from('ai_event_runs').update({ status: 'failed' }).eq('event_id', event.id);
  }
}

/** Human top-level comments get 1-5 distinct AI replies; replies to AI comments get one response. */
export async function runFakebookAIForCommentReply(event: { post_id: string; comment_id: string; content: string }) {
  if (process.env.AI_ENABLED === 'false' || !process.env.GEMINI_API_KEY) return;
  const db = admin();
  try {
    const [{ data: post }, { data: target }, { data: context }, { data: profiles }] = await Promise.all([
      db.from('posts').select('id,content,kind,original_post_id,author:profiles(display_name,username)').eq('id', event.post_id).maybeSingle(),
      db.from('comments').select('id,content,parent_comment_id,author:profiles(display_name,username,account_type)').eq('id', event.comment_id).eq('post_id', event.post_id).maybeSingle(),
      db.from('comments').select('content,parent_comment_id,author:profiles(display_name,username,account_type)').eq('post_id', event.post_id).order('created_at', { ascending: false }).limit(12),
      db.from('profiles').select('id,display_name,username,personality,writing_style').eq('account_type', 'ai').limit(15),
    ]);
    if (!post || !target || !profiles?.length) return;
    const targetAuthor = singleRelation(target.author);
    const isHumanTopLevelComment = target.parent_comment_id === null && targetAuthor?.account_type === 'human';
    const candidates = [...profiles].sort(() => Math.random() - 0.5).slice(0, isHumanTopLevelComment ? 5 : 1);
    const prompt = isHumanTopLevelComment
      ? `Write between 1 and ${candidates.length} natural, concise replies to the human's top-level comment. Pick a number that fits the comment. Each reply should sound like a different AI neighbor from this list, and the app will assign them in the same order. Do not make up profile names, add labels, or write another top-level comment. Return only JSON: {"replies":["...", "..."]}. Each reply must be distinct, relevant, and at most 500 characters.\nPost: ${post.content}\nHuman comment by ${targetAuthor?.display_name || 'neighbor'}: ${target.content}\nAI neighbors, in assignment order: ${JSON.stringify(candidates.map(profile => ({ display_name: profile.display_name, personality: profile.personality, writing_style: profile.writing_style })))}\nRecent thread context: ${JSON.stringify(context || [])}`
      : `You are ${candidates[0].display_name}, an AI neighbor. ${candidates[0].personality || ''} Write one natural, concise reply to the target AI comment. The human just replied to it, so respond to the human's reply while keeping the conversation context. Return only JSON: {"replies":["..."]}. Do not write another top-level comment.\nPost: ${post.content}\nTarget AI comment: ${target.content}\nHuman reply: ${event.content}\nRecent thread context: ${JSON.stringify(context || [])}`;
    const provider: AIProvider = new GeminiProvider();
    const parsed = z.object({ replies: z.array(z.string().trim().min(1).max(500)).min(1).max(candidates.length) }).safeParse(JSON.parse(await provider.generateStructuredJSON(prompt)));
    if (!parsed.success) throw new Error('Gemini returned invalid comment replies.');
    const replies = parsed.data.replies.map((content, index) => ({
      post_id: event.post_id,
      author_id: candidates[index].id,
      parent_comment_id: target.id,
      content,
    }));
    const { error } = await db.from('comments').insert(replies);
    if (error) throw new Error(`Could not save AI comment replies: ${error.message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Fakebook AI comment reply failed: ${message}`);
  }
}
