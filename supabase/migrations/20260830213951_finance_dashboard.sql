-- Finance records are deliberately owned by the authenticated business owner.
-- Gmail secrets are service-side only; the status view below is the sole client surface.

alter table public.invoices
  add column pdf_storage_path text,
  add column pdf_sha256 text,
  add constraint invoices_pdf_sha256_format_check
    check (
      pdf_sha256 is null
      or (pdf_sha256 = lower(pdf_sha256) and pdf_sha256 ~ '^[0-9a-f]{64}$')
    );

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  vendor text not null check (length(btrim(vendor)) > 0),
  vendor_invoice_number text,
  category text not null check (length(btrim(category)) > 0),
  description text,
  expense_date date not null,
  paid_date date,
  net_amount numeric(12,2) not null,
  vat_amount numeric(12,2) not null,
  gross_amount numeric(12,2) generated always as (round(net_amount + vat_amount, 2)) stored,
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'needs_review'
    check (status in ('needs_review', 'booked', 'voided')),
  source text not null default 'upload'
    check (source in ('upload', 'gmail')),
  notes text,
  voided_at timestamp with time zone,
  void_reason text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint expenses_amounts_non_negative check (net_amount >= 0 and vat_amount >= 0),
  constraint expenses_id_user_key unique (id, user_id),
  constraint expenses_void_details_check check (
    (status = 'voided' and voided_at is not null and length(btrim(coalesce(void_reason, ''))) > 0)
    or (status <> 'voided' and voided_at is null and void_reason is null)
  )
);

create table public.expense_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  expense_id uuid not null references public.expenses(id) on delete restrict,
  document_role text not null check (document_role in ('invoice', 'receipt', 'supporting')),
  is_primary boolean not null default false,
  storage_path text not null,
  filename text not null check (length(btrim(filename)) > 0),
  declared_mime_type text,
  detected_mime_type text not null default 'application/pdf'
    check (detected_mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 15728640),
  sha256 text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint expense_documents_path_owner_check
    check (split_part(storage_path, '/', 1) = user_id::text and position('..' in storage_path) = 0),
  constraint expense_documents_sha256_format_check
    check (sha256 = lower(sha256) and sha256 ~ '^[0-9a-f]{64}$'),
  constraint expense_documents_user_sha256_key unique (user_id, sha256),
  constraint expense_documents_id_user_key unique (id, user_id),
  constraint expense_documents_expense_user_fkey
    foreign key (expense_id, user_id) references public.expenses(id, user_id) on delete restrict
);

create unique index expense_documents_one_primary_per_expense_idx
  on public.expense_documents (expense_id)
  where is_primary;

create table public.expense_vendor_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  sender_domain text,
  vendor text,
  action text not null check (action in ('always_include', 'review', 'ignore')),
  default_category text,
  source text not null default 'manual' check (source in ('learned', 'manual')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint expense_vendor_rules_match_target_check check (
    (sender_domain is not null and length(btrim(sender_domain)) > 0)
    or (vendor is not null and length(btrim(vendor)) > 0)
  ),
  constraint expense_vendor_rules_sender_domain_normalized_check
    check (sender_domain is null or sender_domain = lower(btrim(sender_domain))),
  constraint expense_vendor_rules_vendor_normalized_check
    check (vendor is null or vendor = lower(btrim(vendor))),
  constraint expense_vendor_rules_id_user_key unique (id, user_id)
);

create unique index expense_vendor_rules_user_domain_key
  on public.expense_vendor_rules (user_id, sender_domain)
  where sender_domain is not null;

create unique index expense_vendor_rules_user_vendor_key
  on public.expense_vendor_rules (user_id, vendor)
  where vendor is not null;

create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  gmail_address text not null check (gmail_address = lower(btrim(gmail_address))),
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  token_expires_at timestamp with time zone,
  granted_scopes text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'reauthorization_required', 'revoked', 'error')),
  history_id text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint gmail_connections_id_user_key unique (id, user_id)
);

create table public.gmail_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  state_hash text not null,
  pkce_verifier_encrypted text not null,
  redirect_uri text not null,
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint gmail_oauth_states_hash_format_check
    check (state_hash = lower(state_hash) and state_hash ~ '^[0-9a-f]{64}$'),
  constraint gmail_oauth_states_expiry_check check (expires_at > created_at),
  constraint gmail_oauth_states_consumed_check check (consumed_at is null or consumed_at >= created_at),
  constraint gmail_oauth_states_state_hash_key unique (state_hash)
);

-- This projection is maintained by the service-side Gmail integration whenever
-- it changes a connection. It has no token or PKCE material, so it can power a
-- security-invoker client status view without granting access to connections.
create table public.gmail_connection_statuses (
  connection_id uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete restrict,
  gmail_address text not null check (gmail_address = lower(btrim(gmail_address))),
  status text not null check (status in ('active', 'reauthorization_required', 'revoked', 'error')),
  history_id text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint gmail_connection_statuses_connection_user_fkey
    foreign key (connection_id, user_id) references public.gmail_connections(id, user_id) on delete cascade,
  constraint gmail_connection_statuses_connection_user_key unique (connection_id, user_id)
);

create index gmail_oauth_states_pending_expiry_idx
  on public.gmail_oauth_states (expires_at)
  where consumed_at is null;

create table public.gmail_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  connection_id uuid not null references public.gmail_connections(id) on delete restrict,
  sync_kind text not null check (sync_kind in ('historical', 'incremental', 'manual')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  messages_scanned integer not null default 0 check (messages_scanned >= 0),
  candidates_found integer not null default 0 check (candidates_found >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  error_code text,
  error_message text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint gmail_sync_runs_completed_after_start_check
    check (completed_at is null or started_at is null or completed_at >= started_at),
  constraint gmail_sync_runs_id_user_key unique (id, user_id),
  constraint gmail_sync_runs_connection_user_fkey
    foreign key (connection_id, user_id) references public.gmail_connections(id, user_id) on delete restrict
);

create table public.gmail_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  connection_id uuid not null references public.gmail_connections(id) on delete restrict,
  sync_run_id uuid,
  gmail_message_id text not null check (length(btrim(gmail_message_id)) > 0),
  gmail_attachment_id text not null default '',
  gmail_thread_id text,
  sender_email text,
  sender_domain text,
  subject text,
  received_at timestamp with time zone,
  attachment_filename text,
  declared_mime_type text,
  detected_mime_type text check (
    detected_mime_type is null
    or detected_mime_type in ('application/pdf', 'image/jpeg', 'image/png')
  ),
  byte_size bigint check (byte_size is null or (byte_size > 0 and byte_size <= 15728640)),
  sha256 text,
  storage_path text,
  expense_id uuid,
  document_role text check (document_role is null or document_role in ('invoice', 'receipt', 'supporting')),
  matched_vendor_rule_id uuid,
  filter_reason text not null,
  import_state text not null default 'candidate'
    check (import_state in ('candidate', 'excluded', 'needs_review', 'imported', 'duplicate', 'failed')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint gmail_imports_domain_normalized_check
    check (sender_domain is null or sender_domain = lower(btrim(sender_domain))),
  constraint gmail_imports_hash_format_check
    check (sha256 is null or (sha256 = lower(sha256) and sha256 ~ '^[0-9a-f]{64}$')),
  constraint gmail_imports_path_owner_check
    check (storage_path is null or (split_part(storage_path, '/', 1) = user_id::text and position('..' in storage_path) = 0)),
  constraint gmail_imports_connection_user_fkey
    foreign key (connection_id, user_id) references public.gmail_connections(id, user_id) on delete restrict,
  constraint gmail_imports_expense_user_fkey
    foreign key (expense_id, user_id) references public.expenses(id, user_id) on delete set null,
  constraint gmail_imports_sync_run_user_fkey
    foreign key (sync_run_id, user_id) references public.gmail_sync_runs(id, user_id) on delete set null,
  constraint gmail_imports_vendor_rule_user_fkey
    foreign key (matched_vendor_rule_id, user_id) references public.expense_vendor_rules(id, user_id) on delete set null,
  constraint gmail_imports_unique_source_attachment unique (connection_id, gmail_message_id, gmail_attachment_id)
);

create index gmail_imports_user_received_at_idx
  on public.gmail_imports (user_id, received_at desc);

create index gmail_imports_user_state_idx
  on public.gmail_imports (user_id, import_state);

create index gmail_imports_sender_domain_idx
  on public.gmail_imports (user_id, sender_domain);

create table public.tax_export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  tax_year smallint not null check (tax_year between 2000 and 2200),
  export_kind text not null check (export_kind in ('issued_invoices', 'expenses')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'expired')),
  requested_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  expires_at timestamp with time zone,
  storage_path text,
  sha256 text,
  byte_size bigint check (byte_size is null or (byte_size > 0 and byte_size <= 52428800)),
  error_code text,
  error_message text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint tax_export_jobs_completed_after_request_check check (completed_at is null or completed_at >= requested_at),
  constraint tax_export_jobs_expiry_after_request_check check (expires_at is null or expires_at > requested_at),
  constraint tax_export_jobs_hash_format_check
    check (sha256 is null or (sha256 = lower(sha256) and sha256 ~ '^[0-9a-f]{64}$')),
  constraint tax_export_jobs_path_owner_check
    check (storage_path is null or (split_part(storage_path, '/', 1) = user_id::text and position('..' in storage_path) = 0))
);

create index expenses_user_expense_date_idx on public.expenses (user_id, expense_date desc);
create index expenses_user_paid_date_idx on public.expenses (user_id, paid_date desc);
create index expenses_user_status_idx on public.expenses (user_id, status);
create index expense_documents_expense_idx on public.expense_documents (expense_id);
create index gmail_sync_runs_user_created_at_idx on public.gmail_sync_runs (user_id, created_at desc);
create index tax_export_jobs_user_year_idx on public.tax_export_jobs (user_id, tax_year, export_kind, created_at desc);

create table public.expense_audit_log (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('booked', 'voided')),
  previous_status text not null check (previous_status in ('needs_review', 'booked', 'voided')),
  new_status text not null check (new_status in ('needs_review', 'booked', 'voided')),
  void_reason text,
  recorded_at timestamp with time zone not null default now(),
  constraint expense_audit_log_transition_check check (
    (action = 'booked' and new_status = 'booked')
    or (action = 'voided' and new_status = 'voided')
  )
);

create index expense_audit_log_expense_recorded_at_idx
  on public.expense_audit_log (expense_id, recorded_at desc);

create function public.prepare_expense_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'voided' and old.status <> 'voided' and new.voided_at is null then
    new.voided_at = now();
  end if;
  return new;
end;
$$;

create function public.enforce_expense_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'voided' then
    raise exception 'A voided expense is immutable';
  end if;

  if old.status = 'booked' and new.status not in ('booked', 'voided') then
    raise exception 'A booked expense can only remain booked or be voided';
  end if;

  return new;
end;
$$;

create function public.block_voided_expense_document_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.expenses
    where status <> 'needs_review'
      and id in (
        case when tg_op in ('UPDATE', 'DELETE') then old.expense_id else null end,
        case when tg_op in ('UPDATE', 'INSERT') then new.expense_id else null end
      )
  ) then
    raise exception 'Documents can only be changed while their expense needs review';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- This trigger function is deliberately not client-callable. It has a fixed
-- search path and writes only the immutable audit record for the expense row
-- that fired it; direct table writes remain unavailable to authenticated users.
create function public.audit_expense_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status in ('booked', 'voided') then
    insert into public.expense_audit_log (
      expense_id, user_id, action, previous_status, new_status, void_reason
    ) values (
      new.id, new.user_id, new.status, old.status, new.status,
      case when new.status = 'voided' then new.void_reason else null end
    );
  end if;
  return new;
end;
$$;

create trigger expenses_prepare_void
  before update on public.expenses
  for each row execute function public.prepare_expense_void();

create trigger expenses_enforce_lifecycle
  before update on public.expenses
  for each row execute function public.enforce_expense_lifecycle();

create trigger expenses_audit_status_transition
  after update on public.expenses
  for each row execute function public.audit_expense_status_transition();

create trigger expense_documents_block_voided_mutation
  before insert or update or delete on public.expense_documents
  for each row execute function public.block_voided_expense_document_mutation();

create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
create trigger expense_documents_updated_at before update on public.expense_documents
  for each row execute function public.set_updated_at();
create trigger expense_vendor_rules_updated_at before update on public.expense_vendor_rules
  for each row execute function public.set_updated_at();
create trigger gmail_connections_updated_at before update on public.gmail_connections
  for each row execute function public.set_updated_at();
create trigger gmail_connection_statuses_updated_at before update on public.gmail_connection_statuses
  for each row execute function public.set_updated_at();
create trigger gmail_oauth_states_updated_at before update on public.gmail_oauth_states
  for each row execute function public.set_updated_at();
create trigger gmail_sync_runs_updated_at before update on public.gmail_sync_runs
  for each row execute function public.set_updated_at();
create trigger gmail_imports_updated_at before update on public.gmail_imports
  for each row execute function public.set_updated_at();
create trigger tax_export_jobs_updated_at before update on public.tax_export_jobs
  for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;
alter table public.expense_documents enable row level security;
alter table public.expense_vendor_rules enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.gmail_oauth_states enable row level security;
alter table public.gmail_connection_statuses enable row level security;
alter table public.gmail_sync_runs enable row level security;
alter table public.gmail_imports enable row level security;
alter table public.tax_export_jobs enable row level security;
alter table public.expense_audit_log enable row level security;

revoke all on table public.expenses, public.expense_documents, public.expense_vendor_rules,
  public.gmail_connections, public.gmail_oauth_states, public.gmail_sync_runs,
  public.gmail_connection_statuses, public.gmail_imports, public.tax_export_jobs, public.expense_audit_log
  from anon, authenticated;

grant select, insert, update, delete on table public.expenses to authenticated;
grant select, insert, update, delete on table public.expense_documents to authenticated;
grant select, insert, update, delete on table public.expense_vendor_rules to authenticated;
grant select on table public.gmail_sync_runs to authenticated;
grant select on table public.gmail_imports to authenticated;
grant select on table public.tax_export_jobs to authenticated;
grant select on table public.expense_audit_log to authenticated;
grant select on table public.gmail_connection_statuses to authenticated;

create policy "owner reads expenses" on public.expenses
  for select to authenticated
  using (public.is_owner() and auth.uid() = user_id);

create policy "owner creates review expenses" on public.expenses
  for insert to authenticated
  with check (public.is_owner() and auth.uid() = user_id and status = 'needs_review');

create policy "owner updates live expenses" on public.expenses
  for update to authenticated
  using (public.is_owner() and auth.uid() = user_id and status in ('needs_review', 'booked'))
  with check (
    public.is_owner()
    and auth.uid() = user_id
    and status in ('needs_review', 'booked', 'voided')
  );

create policy "owner deletes review expenses" on public.expenses
  for delete to authenticated
  using (public.is_owner() and auth.uid() = user_id and status = 'needs_review');

create policy "owner reads expense documents" on public.expense_documents
  for select to authenticated
  using (public.is_owner() and auth.uid() = user_id)
;

create policy "owner adds review expense documents" on public.expense_documents
  for insert to authenticated
  with check (
    public.is_owner()
    and auth.uid() = user_id
    and exists (
      select 1 from public.expenses
      where id = expense_id and user_id = auth.uid() and status = 'needs_review'
    )
  );

create policy "owner updates review expense documents" on public.expense_documents
  for update to authenticated
  using (
    public.is_owner()
    and auth.uid() = user_id
    and exists (
      select 1 from public.expenses
      where id = expense_id and user_id = auth.uid() and status = 'needs_review'
    )
  )
  with check (
    public.is_owner()
    and auth.uid() = user_id
    and exists (
      select 1 from public.expenses
      where id = expense_id and user_id = auth.uid() and status = 'needs_review'
    )
  );

create policy "owner deletes review expense documents" on public.expense_documents
  for delete to authenticated
  using (
    public.is_owner()
    and auth.uid() = user_id
    and exists (
      select 1 from public.expenses
      where id = expense_id and user_id = auth.uid() and status = 'needs_review'
    )
  );

create policy "owner manages expense vendor rules" on public.expense_vendor_rules
  for all to authenticated
  using (public.is_owner() and auth.uid() = user_id)
  with check (public.is_owner() and auth.uid() = user_id);

create policy "owner reads Gmail sync runs" on public.gmail_sync_runs
  for select to authenticated
  using (public.is_owner() and auth.uid() = user_id);

create policy "owner reads Gmail connection statuses" on public.gmail_connection_statuses
  for select to authenticated
  using (public.is_owner() and auth.uid() = user_id);

create policy "owner reads Gmail imports" on public.gmail_imports
  for select to authenticated
  using (public.is_owner() and auth.uid() = user_id);

create policy "owner reads tax export jobs" on public.tax_export_jobs
  for select to authenticated
  using (public.is_owner() and auth.uid() = user_id);

create policy "owner reads expense audit log" on public.expense_audit_log
  for select to authenticated
  using (public.is_owner() and auth.uid() = user_id);

-- The credential-bearing base connection table has no authenticated grants or
-- RLS policy. The status view reads only the non-secret projection above.
create view public.gmail_connection_status
with (security_barrier = true, security_invoker = true)
as
  select connection_id as id, user_id, gmail_address, status, history_id, last_synced_at, created_at, updated_at
  from public.gmail_connection_statuses
  where public.is_owner() and auth.uid() = user_id;

revoke all on table public.gmail_connection_status from anon, authenticated;
grant select on table public.gmail_connection_status to authenticated;

revoke all on function public.prepare_expense_void(), public.enforce_expense_lifecycle(),
  public.block_voided_expense_document_mutation(), public.audit_expense_status_transition()
  from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('expense-documents', 'expense-documents', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png']),
  ('issued-invoices', 'issued-invoices', false, 10485760, array['application/pdf']),
  ('tax-exports', 'tax-exports', false, 52428800, array['application/zip', 'application/pdf', 'text/csv']);

create policy "owner reads finance storage"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('expense-documents', 'issued-invoices', 'tax-exports')
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner uploads finance storage"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('expense-documents', 'issued-invoices', 'tax-exports')
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner updates finance storage"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('expense-documents', 'issued-invoices', 'tax-exports')
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('expense-documents', 'issued-invoices', 'tax-exports')
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner deletes finance storage"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('expense-documents', 'issued-invoices', 'tax-exports')
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
