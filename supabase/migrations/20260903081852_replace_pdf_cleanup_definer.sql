-- Replace the temporary SECURITY DEFINER cleanup helper with an invoker-only
-- Storage policy predicate. Both archive and cleanup serialize on the exact
-- invoice row, so an object can never be deleted while that invoice is issued.

revoke all on function public.discard_unarchived_invoice_pdf(uuid, text, text)
  from public, anon, authenticated;

drop function public.discard_unarchived_invoice_pdf(uuid, text, text);

create schema finance_private;
revoke all on schema finance_private from public;

create function finance_private.authorize_invoice_pdf_cleanup(
  p_storage_path text,
  p_object_owner_id text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  invoice_id_text text := split_part(p_storage_path, '/', 2);
  checksum text := regexp_replace(split_part(p_storage_path, '/', 3), '[.]pdf$', '');
  current_archive_path text;
begin
  -- Parse only enough to identify the row to lock. Every authorization check
  -- happens after the lock has serialized this delete with the archive RPC.
  if invoice_id_text !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;

  select invoice.pdf_storage_path
  into current_archive_path
  from public.invoices invoice
  where invoice.id = invoice_id_text::uuid
  for update;

  if not found then
    return false;
  end if;

  if auth.uid() is null
    or not public.is_owner()
    or checksum <> lower(checksum)
    or checksum !~ '^[0-9a-f]{64}$'
    or p_storage_path <> auth.uid()::text || '/' || invoice_id_text || '/' || checksum || '.pdf'
    or p_object_owner_id is distinct from auth.uid()::text
    or current_archive_path is not distinct from p_storage_path
    or exists (
      select 1
      from public.invoices referenced_invoice
      where referenced_invoice.pdf_storage_path = p_storage_path
    )
    or not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'issued-invoices'
        and object.name = p_storage_path
        and object.owner_id = auth.uid()::text
    ) then
    return false;
  end if;

  perform set_config('app.invoice_pdf_cleanup_gate', p_storage_path, true);
  return true;
end;
$$;

revoke all on function finance_private.authorize_invoice_pdf_cleanup(text, text)
  from public, anon;
grant usage on schema finance_private to authenticated;
grant execute on function finance_private.authorize_invoice_pdf_cleanup(text, text)
  to authenticated;

create or replace function public.archive_issued_invoice_pdf(
  p_invoice_id uuid,
  p_storage_path text,
  p_sha256 text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.invoice_status;
  current_archive_path text;
  current_archive_sha256 text;
begin
  if not public.is_owner() or auth.uid() is null then
    return false;
  end if;
  if p_sha256 <> lower(p_sha256) or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invoice archive checksum';
  end if;
  if p_storage_path <> auth.uid()::text || '/' || p_invoice_id::text || '/' || p_sha256 || '.pdf' then
    raise exception 'Invalid invoice archive path';
  end if;

  select invoice.status, invoice.pdf_storage_path, invoice.pdf_sha256
  into current_status, current_archive_path, current_archive_sha256
  from public.invoices invoice
  where invoice.id = p_invoice_id
  for update;

  if not found
    or current_status <> 'draft'
    or current_archive_path is not null
    or current_archive_sha256 is not null then
    return false;
  end if;

  -- This check deliberately follows the row lock. A cleanup that won the lock
  -- commits its deletion first, and archive then returns false without writing
  -- a dangling invoice reference.
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'issued-invoices'
      and object.name = p_storage_path
      and object.owner_id = auth.uid()::text
  ) then
    return false;
  end if;

  perform set_config('app.invoice_archive_rpc', 'true', true);
  update public.invoices
  set status = 'pending', pdf_storage_path = p_storage_path, pdf_sha256 = p_sha256
  where id = p_invoice_id
    and status = 'draft'
    and pdf_storage_path is null
    and pdf_sha256 is null;

  return found;
end;
$$;

drop policy if exists "owner deletes unarchived invoice upload" on storage.objects;

create policy "owner deletes unarchived invoice upload"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'issued-invoices'
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
    and owner_id = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/[0-9a-fA-F-]{36}/[0-9a-f]{64}[.]pdf$')
    and not exists (
      select 1
      from public.invoices invoice
      where invoice.pdf_storage_path = name
    )
    and case
      when finance_private.authorize_invoice_pdf_cleanup(name, owner_id) then
        current_setting('app.invoice_pdf_cleanup_gate', true) = name
      else false
    end
  );
