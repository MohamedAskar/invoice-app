-- The archived PDF is the legal/accounting record.  Allowing the normal editor
-- to change the matching invoice values would make the annual CSV disagree
-- with those immutable bytes. Payment state may still progress separately.
create function finance_private.reject_archived_invoice_content_change()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.pdf_storage_path is not null and (
    new.invoice_number is distinct from old.invoice_number or
    new.date is distinct from old.date or
    new.service_period_start is distinct from old.service_period_start or
    new.service_period_end is distinct from old.service_period_end or
    new.client_id is distinct from old.client_id or
    new.client_name is distinct from old.client_name or
    new.client_street is distinct from old.client_street or
    new.client_postal_code is distinct from old.client_postal_code or
    new.client_city is distinct from old.client_city or
    new.client_email is distinct from old.client_email or
    new.subtotal is distinct from old.subtotal or
    new.vat_rate is distinct from old.vat_rate or
    new.vat_amount is distinct from old.vat_amount or
    new.total is distinct from old.total or
    new.payment_terms is distinct from old.payment_terms or
    new.due_date is distinct from old.due_date or
    new.notes is distinct from old.notes
  ) then
    raise exception 'Archived invoice content is immutable';
  end if;
  return new;
end;
$$;
revoke all on function finance_private.reject_archived_invoice_content_change() from public, anon, authenticated;

create trigger invoice_reject_archived_content_change
  before update on public.invoices
  for each row execute function finance_private.reject_archived_invoice_content_change();

create function finance_private.reject_archived_invoice_line_change()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists (select 1 from public.invoices where id in (
    case when tg_op in ('UPDATE','DELETE') then old.invoice_id end,
    case when tg_op in ('UPDATE','INSERT') then new.invoice_id end
  ) and pdf_storage_path is not null) then
    raise exception 'Archived invoice line items are immutable';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function finance_private.reject_archived_invoice_line_change() from public, anon, authenticated;

create trigger invoice_reject_archived_line_change
  before insert or update or delete on public.invoice_line_items
  for each row execute function finance_private.reject_archived_invoice_line_change();
