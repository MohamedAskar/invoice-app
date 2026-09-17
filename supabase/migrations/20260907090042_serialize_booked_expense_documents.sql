-- A booked expense must always retain receipt metadata. The expense row is the
-- serialization point: booking already locks it through UPDATE, and every
-- document mutation explicitly takes the same row lock before it can proceed.
-- That prevents a booking transaction and a document-deletion transaction from
-- independently authorizing from an uncommitted review-state snapshot.

create or replace function public.enforce_expense_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'voided' then
    raise exception 'A voided expense is immutable';
  end if;

  if tg_op = 'UPDATE' and old.status = 'booked' then
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

  if new.status = 'booked' then
    -- For UPDATE this is re-entrant with the row lock acquired by the update
    -- itself. Keeping it explicit documents the shared boundary with the
    -- document trigger below and makes the relationship resilient to future
    -- booking paths.
    perform 1
    from public.expenses expense
    where expense.id = new.id
    for update;

    if not exists (
      select 1
      from public.expense_documents document
      where document.expense_id = new.id
    ) then
      raise exception 'At least one receipt document is required before booking an expense';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_enforce_lifecycle on public.expenses;
create trigger expenses_enforce_lifecycle
  before insert or update on public.expenses
  for each row execute function public.enforce_expense_lifecycle();

create or replace function public.block_voided_expense_document_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  locked_expense record;
begin
  -- Lock every affected parent in a deterministic order. In ordinary document
  -- inserts/deletes this is one expense; UPDATE locks both old and new parents
  -- so a future reassignment cannot introduce a deadlock or bypass booking.
  for locked_expense in
    select expense.id, expense.status
    from public.expenses expense
    where expense.id = any (array_remove(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.expense_id end,
      case when tg_op in ('UPDATE', 'INSERT') then new.expense_id end
    ], null))
    order by expense.id
    for update
  loop
    if locked_expense.status <> 'needs_review' then
      raise exception 'Documents can only be changed while their expense needs review';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
