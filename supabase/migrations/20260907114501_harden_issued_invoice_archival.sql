-- Created with `supabase migration new harden_issued_invoice_archival`, then
-- ordered after the existing future-dated 20260907114500 migration.
alter table public.invoices
  add column content_revision bigint not null default 0,
  add column archive_intent text check (archive_intent in ('issue', 'backfill'));

-- The marker represents an incomplete attempt, never a completed PDF archive.
alter table public.invoices add constraint invoice_archive_intent_check check (
  archive_intent is null or (
    status in ('pending', 'paid', 'overdue')
    and pdf_storage_path is null and pdf_sha256 is null
  )
);

create or replace function public.enforce_invoice_pdf_archive()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  archive_context boolean := coalesce(current_setting('app.invoice_archive_id', true), '') = new.id::text;
  prepare_context boolean := coalesce(current_setting('app.invoice_prepare_id', true), '') = new.id::text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.archive_intent is not null
      or new.pdf_storage_path is not null or new.pdf_sha256 is not null then
      raise exception 'New invoices must be drafts until the issue action';
    end if;
    new.content_revision := 0;
    return new;
  end if;

  -- Every update advances the revision except our narrowly scoped archive and
  -- preparation writes. Callers cannot assign or reset this server value.
  new.content_revision := old.content_revision + case when archive_context or prepare_context then 0 else 1 end;

  if old.pdf_storage_path is not null or old.pdf_sha256 is not null then
    if new.pdf_storage_path is distinct from old.pdf_storage_path
      or new.pdf_sha256 is distinct from old.pdf_sha256 then
      raise exception 'An archived invoice PDF is immutable';
    end if;
  elsif new.pdf_storage_path is distinct from old.pdf_storage_path
    or new.pdf_sha256 is distinct from old.pdf_sha256 then
    if not archive_context or old.archive_intent is null
      or new.pdf_storage_path is null or new.pdf_sha256 is null
      or new.pdf_sha256 !~ '^[0-9a-f]{64}$'
      or new.pdf_storage_path <> auth.uid()::text || '/' || new.id::text || '/' || new.pdf_sha256 || '.pdf'
      or new.status is distinct from old.status or new.archive_intent is not null then
      raise exception 'Invoice PDFs must be archived through the issue or confirmed backfill action';
    end if;
  end if;

  if new.archive_intent is distinct from old.archive_intent then
    if not ((prepare_context and new.archive_intent is not null)
      or (archive_context and new.archive_intent is null and new.pdf_storage_path is not null)) then
      raise exception 'Archive intent must be set through a controlled action';
    end if;
  end if;

  if old.status = 'draft' and new.status <> 'draft' then
    if not prepare_context or new.status <> 'pending' or new.archive_intent <> 'issue'
      or new.pdf_storage_path is not null or new.pdf_sha256 is not null then
      raise exception 'Issuing an invoice requires the controlled archive action';
    end if;
  elsif old.status in ('pending', 'paid', 'overdue') and old.pdf_storage_path is null
    and new.status is distinct from old.status then
    if old.archive_intent is not null or old.status not in ('pending', 'overdue') or new.status <> 'paid' then
      raise exception 'Legacy invoice status is immutable until the missing invoice archive is completed';
    end if;
  end if;
  return new;
end;
$$;

-- Line writes acquire the SAME parent lock as archive, and advance its revision
-- before the line changes. A single SELECT of invoice + nested lines therefore
-- observes a consistent revision/snapshot even if another tab is saving.
create function finance_private.advance_invoice_line_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent_id uuid;
begin
  for parent_id in
    select invoice.id from public.invoices invoice
    where invoice.id = any(array_remove(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.invoice_id end,
      case when tg_op in ('INSERT', 'UPDATE') then new.invoice_id end
    ], null)) order by invoice.id for update
  loop
    update public.invoices set content_revision = content_revision + 1 where id = parent_id;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function finance_private.advance_invoice_line_revision() from public, anon, authenticated;
create trigger invoice_line_items_advance_revision
  before insert or update or delete on public.invoice_line_items
  for each row execute function finance_private.advance_invoice_line_revision();

create function public.prepare_invoice_archive(p_invoice_id uuid, p_expected_revision bigint, p_intent text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  invoice public.invoices%rowtype;
begin
  if auth.uid() is null or not public.is_owner() then return false; end if;
  select * into invoice from public.invoices where id = p_invoice_id for update;
  if not found or p_expected_revision is distinct from invoice.content_revision
    or invoice.pdf_storage_path is not null or invoice.pdf_sha256 is not null then return false; end if;
  if p_intent = 'issue' then
    if invoice.status <> 'draft'
      and (invoice.status <> 'pending' or invoice.archive_intent is distinct from 'issue') then
      return false;
    end if;
  elsif p_intent = 'backfill' then
    if invoice.status not in ('pending', 'paid', 'overdue')
      or (invoice.archive_intent is not null and invoice.archive_intent = 'issue') then
      return false;
    end if;
  else return false;
  end if;
  perform set_config('app.invoice_prepare_id', p_invoice_id::text, true);
  update public.invoices set
    status = case when status = 'draft' then 'pending' else status end,
    archive_intent = p_intent where id = p_invoice_id;
  perform set_config('app.invoice_prepare_id', '', true);
  return true;
end;
$$;

-- Remove the old, broad endpoint: every caller must present the revision that
-- was read with the PDF's content and the separately prepared operation intent.
drop function public.archive_issued_invoice_pdf(uuid, text, text);
create function public.archive_issued_invoice_pdf(
  p_invoice_id uuid, p_storage_path text, p_sha256 text,
  p_expected_revision bigint, p_intent text
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  invoice public.invoices%rowtype;
begin
  if auth.uid() is null or not public.is_owner() then return false; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invoice archive checksum'; end if;
  if p_storage_path is distinct from auth.uid()::text || '/' || p_invoice_id::text || '/' || p_sha256 || '.pdf' then
    raise exception 'Invalid invoice archive path';
  end if;
  select * into invoice from public.invoices where id = p_invoice_id for update;
  if not found or p_expected_revision is distinct from invoice.content_revision
    or invoice.pdf_storage_path is not null or invoice.pdf_sha256 is not null
    or p_intent is null or p_intent not in ('issue', 'backfill')
    or invoice.archive_intent is distinct from p_intent
    or (p_intent = 'issue' and invoice.status <> 'pending')
    or invoice.status not in ('pending', 'paid', 'overdue') then return false; end if;
  -- Always recheck after the parent lock; cleanup may have just won the race.
  if not exists (select 1 from storage.objects object where object.bucket_id = 'issued-invoices'
    and object.name = p_storage_path and object.owner_id = auth.uid()::text) then return false; end if;
  perform set_config('app.invoice_archive_id', p_invoice_id::text, true);
  update public.invoices set pdf_storage_path = p_storage_path, pdf_sha256 = p_sha256,
    archive_intent = null where id = p_invoice_id;
  perform set_config('app.invoice_archive_id', '', true);
  return true;
end;
$$;
revoke all on function public.prepare_invoice_archive(uuid, bigint, text),
  public.archive_issued_invoice_pdf(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.prepare_invoice_archive(uuid, bigint, text),
  public.archive_issued_invoice_pdf(uuid, text, text, bigint, text) to authenticated;

drop policy if exists "owner uploads missing invoice archives" on storage.objects;
create policy "owner uploads prepared invoice archives" on storage.objects for insert to authenticated
with check (
  bucket_id = 'issued-invoices' and public.is_owner()
  and name ~ ('^' || auth.uid()::text || '/[0-9a-fA-F-]{36}/[0-9a-f]{64}[.]pdf$')
  and exists (select 1 from public.invoices invoice
    where invoice.id::text = split_part(name, '/', 2)
      and invoice.archive_intent in ('issue', 'backfill')
      and invoice.pdf_storage_path is null and invoice.pdf_sha256 is null)
);

-- Restore this authorization explicitly in follow-on migration order. The
-- invoker predicate locks the owning invoice and rechecks every reference.
drop policy if exists "owner deletes unarchived invoice upload" on storage.objects;
create policy "owner deletes unarchived invoice upload" on storage.objects for delete to authenticated
using (
  bucket_id = 'issued-invoices' and public.is_owner()
  and owner_id = auth.uid()::text
  and name ~ ('^' || auth.uid()::text || '/[0-9a-fA-F-]{36}/[0-9a-f]{64}[.]pdf$')
  and case when finance_private.authorize_invoice_pdf_cleanup(name, owner_id)
    then current_setting('app.invoice_pdf_cleanup_gate', true) = name else false end
);

-- The audit trigger is the last application SECURITY DEFINER in the deployed
-- history. Permit only a nested trigger write, never a direct browser INSERT.
-- pg_trigger_depth is maintained by PostgreSQL, not a forgeable request GUC.
alter function public.audit_expense_status_transition() security invoker;
grant insert on public.expense_audit_log to authenticated;
create policy "owner trigger records expense transitions" on public.expense_audit_log
for insert to authenticated with check (
  pg_trigger_depth() = 1 and public.is_owner() and user_id = auth.uid()
  and exists (select 1 from public.expenses expense where expense.id = expense_id
    and expense.user_id = auth.uid() and expense.status = new_status
    and expense.void_reason is not distinct from expense_audit_log.void_reason)
);
