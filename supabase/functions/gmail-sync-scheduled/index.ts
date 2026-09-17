import { syncRuntime } from '../_shared/gmail-sync-runtime.ts';

export async function handleScheduledSync(request: Request, deps: { cronSecret?: string; scheduledUsers(queuedOnly: boolean): Promise<{ user_id: string }[]>; sync(user: string): Promise<unknown> }) {
  const candidate = request.headers.get('x-gmail-cron-secret') ?? '';
  const expected = deps.cronSecret ?? '';
  const equal = async () => {
    if(expected.length < 32 || !candidate) return false;
    const hash = async (s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
    const [a,b] = await Promise.all([hash(candidate),hash(expected)]); let delta = 0; for(let i=0;i<a.length;i++) delta |= a[i]^b[i]; return delta===0;
  };
  if(request.method !== 'POST' || !await equal()) return Response.json({error:'Unauthorized.'},{status:401,headers:{'Cache-Control':'no-store'}});
  const body = await request.json().catch(()=>null);
  if(!body || !['daily','queued'].includes(body.mode)) return Response.json({error:'Invalid request.'},{status:400});
  let completed=0, failed=0;
  for(const user of await deps.scheduledUsers(body.mode==='queued')) {
    try { await deps.sync(user.user_id); completed++; } catch { failed++; }
  }
  return Response.json({completed,failed},{headers:{'Cache-Control':'no-store'}});
}
if(import.meta.main) {
  Deno.serve(async request=>{
    try { return await handleScheduledSync(request,syncRuntime(name=>Deno.env.get(name))); }
    catch { return Response.json({error:'Gmail sync is unavailable.'},{status:503}); }
  });
}
