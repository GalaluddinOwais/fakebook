import { describe, expect, it } from 'vitest';
import { retryGeminiUnavailable, validateAIOutput } from './ai';
const ai='00000000-0000-4000-8000-000000000001', thread='10000000-0000-4000-8000-000000000001';
describe('AI response validation',()=>{
  it('rejects malformed output and fabricated profile or share IDs',()=>{
    expect(validateAIOutput({actions:'wrong'},[ai],[],[],thread)).toBeNull();
    const out=validateAIOutput({thread_summary:'brief',actions:[{profile_id:ai,type:'share',target_id:'20000000-0000-4000-8000-000000000009'},{profile_id:'30000000-0000-4000-8000-000000000009',type:'reaction',target_id:thread,reaction:'like'}]},[ai],[],[],thread);
    expect(out?.actions).toEqual([]);
  });
  it('allows only valid thread actions and bounded summary',()=>{
    const ai2='00000000-0000-4000-8000-000000000002';
    const out=validateAIOutput({thread_summary:'remember this',actions:[{profile_id:ai,type:'comment',target_id:thread,content:'Hello'},{profile_id:ai2,type:'reaction',target_id:thread,reaction:'haha'}]},[ai,ai2],[],[],thread);
    expect(out?.actions).toHaveLength(2);
    expect(validateAIOutput({thread_summary:'',actions:[{profile_id:ai,type:'reaction',target_id:thread,reaction:'angry'}]},[ai],[],[],thread)).toBeNull();
  });
  it('keeps thread context scoped by validating target IDs',()=>{
    const out=validateAIOutput({thread_summary:'',actions:[{profile_id:ai,type:'comment',target_id:'40000000-0000-4000-8000-000000000001',content:'wrong thread'}]},[ai],[],[],thread);
    expect(out?.actions).toHaveLength(0);
  });
  it('allows one action per AI profile in an event',()=>{
    const out=validateAIOutput({thread_summary:'',actions:[{profile_id:ai,type:'comment',target_id:thread,content:'Hello'},{profile_id:ai,type:'reaction',target_id:thread,reaction:'like'}]},[ai],[],[],thread);
    expect(out?.actions).toHaveLength(1);
  });
  it('retries transient Gemini 503s, but stops after two retries',async()=>{
    let calls=0;const waits:number[]=[];
    const result=await retryGeminiUnavailable(async()=>{calls++;if(calls<3)throw Object.assign(new Error('busy'),{status:503});return 'ok';},async ms=>{waits.push(ms)});
    expect(result).toBe('ok');expect(calls).toBe(3);expect(waits).toHaveLength(2);
  });
  it('does not retry non-503 errors',async()=>{
    let calls=0;
    await expect(retryGeminiUnavailable(async()=>{calls++;throw Object.assign(new Error('bad request'),{status:400});},async()=>{})).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });
});
