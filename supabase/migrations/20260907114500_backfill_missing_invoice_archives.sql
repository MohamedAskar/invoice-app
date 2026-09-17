-- Task 4 permits a deliberate UI-confirmed backfill for legacy issued rows
-- that predate PDF freezing. Existing archive paths remain immutable.

drop policy if exists "owner uploads draft invoice archives" on storage.objects;

create policy "owner uploads missing invoice archives"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issued-invoices'
    and public.is_owner()
    and name ~ ('^' || auth.uid()::text || '/[0-9a-fA-F-]{36}/[0-9a-f]{64}[.]pdf$')
    and exists (
      select 1
      from public.invoices invoice
      where invoice.id = split_part(name, '/', 2)::uuid
        and invoice.status in ('draft', 'pending', 'paid', 'overdue')
        and invoice.pdf_storage_path is null
        and invoice.pdf_sha256 is null
    )
  );

create or replace function public.enforce_invoice_pdf_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archive_context boolean := coalesce(current_setting('app.invoice_archive_rpc', true), '') = 'true';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New invoices must be drafts until issued with an archived PDF';
    end if;
    if new.pdf_storage_path is not null or new.pdf_sha256 is not null then
      raise exception 'Invoice PDFs must be archived through the issue action';
    end if;
    return new;
  end if;

  if old.pdf_storage_path is not null or old.pdf_sha256 is not null then
    if new.pdf_storage_path is distinct from old.pdf_storage_path
      or new.pdf_sha256 is distinct from old.pdf_sha256 then
      raise exception 'An archived invoice PDF is immutable';
    end if;
  elsif new.pdf_storage_path is distinct from old.pdf_storage_path
    or new.pdf_sha256 is distinct from old.pdf_sha256 then
    if not archive_context
      or new.pdf_storage_path is null
      or new.pdf_sha256 is null
      or new.pdf_sha256 <> lower(new.pdf_sha256)
      or new.pdf_sha256 !~ '^[0-9a-f]{64}$'
      or new.pdf_storage_path !~ ('^[^/]+/' || new.id::text || '/' || new.pdf_sha256 || '[.]pdf$')
      or (
        (old.status = 'draft' and new.status <> 'pending')
        or (
          old.status in ('pending', 'paid', 'overdue')
          and new.status is distinct from old.status
        )
        or old.status not in ('draft', 'pending', 'paid', 'overdue')
      ) then
      raise exception 'Invoice PDFs must be archived through the issue action';
    end if;
  end if;

  if old.status = 'draft' and new.status <> 'draft' then
    if not archive_context
      or new.status <> 'pending'
      or new.pdf_storage_path is null
      or new.pdf_sha256 is null then
      raise exception 'Issuing an invoice requires an archived PDF';
    end if;
  elsif old.status in ('pending', 'paid', 'overdue')
    and old.pdf_storage_path is null
    and old.pdf_sha256 is null
    and new.status is distinct from old.status then
    -- Legacy pending/overdue rows may complete payment before a deliberate
    -- backfill, but no other non-archive transition is permitted.
    if old.status not in ('pending', 'overdue') or new.status <> 'paid' then
      raise exception 'Unarchived legacy invoice status is immutable';
    end if;
  end if;

  return new;
end;
$$;

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
    or current_status not in ('draft', 'pending', 'paid', 'overdue')
    or current_archive_path is not null
    or current_archive_sha256 is not null then
    return false;
  end if;

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
  set status = case when status = 'draft' then 'pending' else status end,
      pdf_storage_path = p_storage_path,
      pdf_sha256 = p_sha256
  where id = p_invoice_id
    and status in ('draft', 'pending', 'paid', 'overdue')
    and pdf_storage_path is null
    and pdf_sha256 is null;

  return found;
end;
$$;
