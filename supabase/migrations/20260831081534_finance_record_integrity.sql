-- Tighten finance record and private-document integrity after the initial
-- dashboard schema. This migration is additive and does not rewrite history.

create or replace function public.enforce_expense_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'voided' then
    raise exception 'A voided expense is immutable';
  end if;

  if old.status = 'booked' then
    if new.status <> 'voided' then
      raise exception 'A booked expense can only transition to voided';
    end if;

    if new.user_id is distinct from old.user_id
      or new.vendor is distinct from old.vendor
      or new.vendor_invoice_number is distinct from old.vendor_invoice_number
      or new.category is distinct from old.category
      or new.description is distinct from old.description
      or new.expense_date is distinct from old.expense_date
      or new.paid_date is distinct from old.paid_date
      or new.net_amount is distinct from old.net_amount
      or new.vat_amount is distinct from old.vat_amount
      or new.currency is distinct from old.currency
      or new.source is distinct from old.source
      or new.notes is distinct from old.notes then
      raise exception 'A booked expense is immutable except for voiding';
    end if;
  end if;

  return new;
end;
$$;

alter table public.expense_documents
  drop constraint expense_documents_expense_id_fkey,
  drop constraint expense_documents_expense_user_fkey;

alter table public.expense_documents
  add constraint expense_documents_expense_id_fkey
    foreign key (expense_id) references public.expenses(id) on delete cascade,
  add constraint expense_documents_expense_user_fkey
    foreign key (expense_id, user_id) references public.expenses(id, user_id) on delete cascade;

drop policy "owner uploads finance storage" on storage.objects;
drop policy "owner updates finance storage" on storage.objects;
drop policy "owner deletes finance storage" on storage.objects;

create policy "owner uploads review expense documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'expense-documents'
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
    and split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.expenses expense
      where expense.id = split_part(name, '/', 2)::uuid
        and expense.user_id = auth.uid()
        and expense.status = 'needs_review'
    )
  );

create policy "owner updates review expense document objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'expense-documents'
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.expense_documents document
      join public.expenses expense on expense.id = document.expense_id
      where document.storage_path = name
        and document.user_id = auth.uid()
        and expense.user_id = auth.uid()
        and expense.status = 'needs_review'
    )
  )
  with check (
    bucket_id = 'expense-documents'
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.expense_documents document
      join public.expenses expense on expense.id = document.expense_id
      where document.storage_path = name
        and document.user_id = auth.uid()
        and expense.user_id = auth.uid()
        and expense.status = 'needs_review'
    )
  );

create policy "owner deletes review expense document objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'expense-documents'
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.expense_documents document
      join public.expenses expense on expense.id = document.expense_id
      where document.storage_path = name
        and document.user_id = auth.uid()
        and expense.user_id = auth.uid()
        and expense.status = 'needs_review'
    )
  );

create policy "owner uploads draft invoice archives"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issued-invoices'
    and public.is_owner()
    and name ~ ('^' || auth.uid()::text || '/[0-9a-fA-F-]{36}/[0-9a-f]{64}[.]pdf$')
    and exists (
      select 1
      from public.invoices invoice
      where invoice.id = split_part(name, '/', 2)::uuid
        and invoice.status = 'draft'
        and invoice.pdf_storage_path is null
        and invoice.pdf_sha256 is null
    )
  );

create function public.delete_review_expense(p_expense_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status text;
begin
  select status into current_status
  from public.expenses
  where id = p_expense_id and user_id = auth.uid();

  if not found then
    return false;
  end if;
  if not public.is_owner() then
    return false;
  end if;
  if current_status <> 'needs_review' then
    raise exception 'Financial record is immutable';
  end if;

  -- Storage objects must be removed through the Storage API (which owns their
  -- backing blobs). Refuse to cascade metadata while one still exists.
  if exists (
    select 1
    from storage.objects object
    join public.expense_documents document on document.storage_path = object.name
    where object.bucket_id = 'expense-documents'
      and document.expense_id = p_expense_id
      and document.user_id = auth.uid()
  ) then
    raise exception 'Review document objects must be deleted before the expense';
  end if;

  -- The document metadata cascade and parent deletion are one transaction.

  delete from public.expenses
  where id = p_expense_id
    and user_id = auth.uid()
    and status = 'needs_review';

  return found;
end;
$$;

create function public.enforce_invoice_pdf_archive()
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
      or old.status <> 'draft'
      or new.status <> 'pending'
      or new.pdf_storage_path is null
      or new.pdf_sha256 is null
      or new.pdf_sha256 <> lower(new.pdf_sha256)
      or new.pdf_sha256 !~ '^[0-9a-f]{64}$'
      or new.pdf_storage_path !~ ('^[^/]+/' || new.id::text || '/' || new.pdf_sha256 || '[.]pdf$') then
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
    -- Existing pre-integrity pending/overdue rows can complete their normal
    -- lifecycle, but no other status transition may bypass the archive gate.
    if old.status not in ('pending', 'overdue') or new.status <> 'paid' then
      raise exception 'Unarchived legacy invoice status is immutable';
    end if;
  end if;

  return new;
end;
$$;

create trigger invoices_enforce_pdf_archive
  before insert or update on public.invoices
  for each row execute function public.enforce_invoice_pdf_archive();

create function public.archive_issued_invoice_pdf(
  p_invoice_id uuid,
  p_storage_path text,
  p_sha256 text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
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
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'issued-invoices' and object.name = p_storage_path
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

create function public.discard_unarchived_invoice_pdf(
  p_invoice_id uuid,
  p_storage_path text,
  p_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() or auth.uid() is null then
    return false;
  end if;
  if p_storage_path <> auth.uid()::text || '/' || p_invoice_id::text || '/' || p_sha256 || '.pdf' then
    return false;
  end if;
  if not exists (
    select 1 from public.invoices invoice
    where invoice.id = p_invoice_id
      and invoice.pdf_storage_path is distinct from p_storage_path
  ) then
    return false;
  end if;

  delete from storage.objects object
  where object.bucket_id = 'issued-invoices' and object.name = p_storage_path;
  return found;
end;
$$;

revoke all on function public.delete_review_expense(uuid),
  public.archive_issued_invoice_pdf(uuid, text, text),
  public.discard_unarchived_invoice_pdf(uuid, text, text),
  public.enforce_invoice_pdf_archive()
  from public, anon;
grant execute on function public.delete_review_expense(uuid),
  public.archive_issued_invoice_pdf(uuid, text, text),
  public.discard_unarchived_invoice_pdf(uuid, text, text)
  to authenticated;
