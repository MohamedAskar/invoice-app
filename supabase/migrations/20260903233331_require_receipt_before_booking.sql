-- Booking is a financial-record lifecycle transition, so it must not rely on
-- the browser's disabled button. The existing trigger is the transaction
-- boundary for status changes and sees receipt metadata before the update.

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

  if old.status = 'needs_review' and new.status = 'booked'
    and not exists (
      select 1
      from public.expense_documents document
      where document.expense_id = old.id
    ) then
    raise exception 'At least one receipt document is required before booking an expense';
  end if;

  return new;
end;
$$;
