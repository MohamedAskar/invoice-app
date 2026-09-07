#!/usr/bin/env bash

# Proves the booking/document-delete race with two real PostgreSQL sessions.
# It intentionally commits the fixture so both sessions can see it, then removes
# the fixture on exit. Run after `supabase db reset --local --no-seed`.
set -euo pipefail

container_name="${SUPABASE_DB_CONTAINER:-supabase_db_finance-dashboard}"
owner_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
expense_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
document_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
book_output="$(mktemp)"
delete_output="$(mktemp)"

cleanup() {
  rm -f "$book_output" "$delete_output"
  docker exec -i "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || true
delete from public.expense_documents where id = '$document_id';
delete from public.expenses where id = '$expense_id';
delete from auth.users where id = '$owner_id';
SQL
}
trap cleanup EXIT

docker exec -i "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '$owner_id', '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', 'expense-race-$owner_id@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.expenses (
  id, user_id, vendor, category, expense_date, net_amount, vat_amount
) values (
  '$expense_id', '$owner_id', 'concurrent booking', 'software', '2026-03-05', 1, 0
);

insert into public.expense_documents (
  id, user_id, expense_id, document_role, storage_path, filename,
  detected_mime_type, byte_size, sha256
) values (
  '$document_id', '$owner_id', '$expense_id', 'receipt',
  '$owner_id/$expense_id/receipt.pdf', 'receipt.pdf', 'application/pdf', 100,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
SQL

docker exec -i "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >"$book_output" 2>&1 <<SQL &
begin;
update public.expenses set status = 'booked' where id = '$expense_id';
select pg_sleep(2);
commit;
SQL
book_pid=$!
sleep 0.2

if docker exec -i "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >"$delete_output" 2>&1 <<SQL
delete from public.expense_documents where id = '$document_id';
SQL
then
  wait "$book_pid"
  echo "document deletion was allowed while booking held the expense lock" >&2
  exit 1
fi

wait "$book_pid"

if ! rg -qi "documents can only be changed" "$delete_output"; then
  sed -n '1,200p' "$delete_output" >&2
  exit 1
fi

if ! docker exec -i "$container_name" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 <<SQL | rg -qx 'ok'
select case when expense.status = 'booked' and count(document.id) = 1 then 'ok' else 'invalid' end
from public.expenses expense
left join public.expense_documents document on document.expense_id = expense.id
where expense.id = '$expense_id'
group by expense.status;
SQL
then
  echo "booking race left an expense without its receipt document" >&2
  exit 1
fi

echo "expense booking/document deletion concurrency proof passed"
