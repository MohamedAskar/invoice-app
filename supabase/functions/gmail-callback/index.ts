import { handleCallback } from '../_shared/google-oauth.ts';
import { gmailDependencies } from '../_shared/gmail-runtime.ts';

Deno.serve(async (request) => {
  try { return await handleCallback(request, gmailDependencies((name) => Deno.env.get(name))); }
  catch { return Response.json({ error: 'Gmail is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
});
