import { equal, ok } from 'node:assert/strict';

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
function process() {
  return new Deno.Command('docker', { args: ['exec', '-i', 'supabase_db_finance-dashboard', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
}
async function query(statement: string) {
  const child = process(); const input = child.stdin.getWriter();
  await input.write(encode(statement)); await input.close();
  const result = await child.output();
  ok(result.success, decode(result.stderr)); return decode(result.stdout);
}
async function heldTransaction(statement: string) {
  const child = process(); const input = child.stdin.getWriter(); const reader = child.stdout.getReader();
  await input.write(encode(`begin; ${statement}; select 'LOCK_HELD';\n`));
  let output = '';
  while (!output.includes('LOCK_HELD')) {
    const chunk = await reader.read();
    ok(!chunk.done, 'Transaction ended before acquiring its lock');
    output += decode(chunk.value!);
  }
  return async () => {
    await input.write(encode('commit;\n')); await input.close();
    while (!(await reader.read()).done) { /* Drain the committed session. */ }
    reader.releaseLock();
    const result = await child.status;
    const error = await new Response(child.stderr).text();
    ok(result.success, error);
  };
}

Deno.test('real PostgreSQL sessions serialize timeout/cleanup against worker finalization', async () => {
  equal((await query('select count(*) from auth.users')).trim(), '0', 'Use an empty disposable local Auth database.');
  const owner = crypto.randomUUID(); const timedOut = crypto.randomUUID(); const completed = crypto.randomUUID(); const token = crypto.randomUUID();
  try {
    await query(`insert into auth.users(id,aud,role,email) values('${owner}','authenticated','authenticated','${owner}@example.test');
      insert into public.tax_export_jobs(id,user_id,tax_year,export_kind,expires_at) values
      ('${timedOut}','${owner}',2026,'issued_invoices',now()+interval '24 hours'),
      ('${completed}','${owner}',2026,'issued_invoices',now()+interval '24 hours');
      select public.claim_tax_export_job('${timedOut}','${owner}','${token}');
      select public.claim_tax_export_job('${completed}','${owner}','${token}');`);

    // The timeout session holds the changed row uncommitted. A finalizer that
    // selected the old running version must re-check its CAS after that lock.
    const releaseTimeout = await heldTransaction(`update public.tax_export_jobs set lease_expires_at=now()-interval '1 second' where id='${timedOut}';
      select public.reap_tax_export_job('${timedOut}','${owner}')`);
    const lateWorker = query(`select count(*) from public.complete_tax_export_job('${timedOut}','${owner}','${token}',repeat('a',64),100);`);
    await releaseTimeout();
    equal((await lateWorker).trim(), '0');
    equal((await query(`select status||':'||cleanup_pending from public.tax_export_jobs where id='${timedOut}'`)).trim(), 'failed:true');

    // Conversely, cleanup skips a row held by an active completing worker. It
    // must not delete the eventual completed ZIP using an earlier running row.
    const releaseCompletion = await heldTransaction(`select public.complete_tax_export_job('${completed}','${owner}','${token}',repeat('b',64),100)`);
    try {
      equal((await query(`select count(*) from public.claim_tax_export_cleanup(100) where id='${completed}';`)).trim(), '0');
    } finally { await releaseCompletion(); }
    equal((await query(`select status from public.tax_export_jobs where id='${completed}'`)).trim(), 'completed');
    equal((await query(`select count(*) from public.claim_tax_export_cleanup(100) where id='${completed}';`)).trim(), '0');
  } finally {
    await query(`delete from public.tax_export_jobs where user_id='${owner}'; delete from auth.users where id='${owner}';`);
  }
});
