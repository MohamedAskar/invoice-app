set local check_function_bodies = off;

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "anon";

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "authenticated";

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "service_role";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "anon";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "authenticated";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "service_role";

create table "public"."business_settings" (
  "id"                      smallint                 not null default 1,
  "name"                    text                     not null default ''::text,
  "street"                  text                     not null default ''::text,
  "postal_code"             text                     not null default ''::text,
  "city"                    text                     not null default ''::text,
  "tax_number"              text,
  "tax_number_pending"      boolean                  not null default false,
  "email"                   text,
  "phone"                   text,
  "bank_account_holder"     text                     not null default ''::text,
  "bank_iban"               text                     not null default ''::text,
  "bank_bic"                text                     not null default ''::text,
  "bank_name"               text                     not null default ''::text,
  "default_payment_terms"   integer                  not null default 14,
  "is_kleinunternehmer"     boolean                  not null default true,
  "invoice_prefix"          text                     not null default ''::text,
  "starting_invoice_number" integer                  not null default 1,
  "currency"                text                     not null default 'EUR'::text,
  "created_at"              timestamp with time zone not null default now(),
  "updated_at"              timestamp with time zone not null default now(),
  constraint "business_settings_id_check" check ((id = 1)),
  constraint "business_settings_pkey" primary key (id)
);

alter table "public"."business_settings"
  enable row level security;

create table "public"."clients" (
  "id"          uuid                     not null default gen_random_uuid(),
  "name"        text                     not null,
  "street"      text                     not null default ''::text,
  "postal_code" text                     not null default ''::text,
  "city"        text                     not null default ''::text,
  "email"       text,
  "created_at"  timestamp with time zone not null default now(),
  "updated_at"  timestamp with time zone not null default now(),
  constraint "clients_pkey" primary key (id)
);

alter table "public"."clients"
  enable row level security;

create table "public"."invoice_line_items" (
  "id"              uuid                     not null default gen_random_uuid(),
  "invoice_id"      uuid                     not null,
  "position"        integer                  not null default 0,
  "description"     text                     not null,
  "sub_description" text,
  "quantity"        numeric(12,2)            not null default 1,
  "unit"            text                     not null default 'Pauschal'::text,
  "unit_price"      numeric(12,2)            not null default 0,
  "total"           numeric(12,2)            not null default 0,
  "created_at"      timestamp with time zone not null default now(),
  constraint "invoice_line_items_pkey" primary key (id)
);

alter table "public"."invoice_line_items"
  enable row level security;

create table "public"."invoices" (
  "id"                   uuid                     not null default gen_random_uuid(),
  "invoice_number"       text                     not null,
  "date"                 date                     not null,
  "service_period_start" date,
  "service_period_end"   date,
  "client_id"            uuid                     not null,
  "client_name"          text                     not null,
  "client_street"        text                     not null default ''::text,
  "client_postal_code"   text                     not null default ''::text,
  "client_city"          text                     not null default ''::text,
  "client_email"         text,
  "subtotal"             numeric(12,2)            not null default 0,
  "vat_rate"             numeric(5,2)             not null default 0,
  "vat_amount"           numeric(12,2)            not null default 0,
  "total"                numeric(12,2)            not null default 0,
  "payment_terms"        integer                  not null default 14,
  "due_date"             date                     not null,
  "paid_date"            date,
  "notes"                text,
  "created_at"           timestamp with time zone not null default now(),
  "updated_at"           timestamp with time zone not null default now(),
  constraint "invoices_invoice_number_key" unique (invoice_number),
  constraint "invoices_pkey" primary key (id)
);

alter table "public"."invoices"
  enable row level security;

create type "public"."invoice_status" as enum (
  'draft',
  'pending',
  'paid',
  'overdue'
);

alter table "public"."invoices"
  add column "status" public.invoice_status not null default 'draft'::public.invoice_status;

create or replace function public.is_owner()
  returns boolean
  language sql
  stable
  set search_path to ''
  AS $function$
  select coalesce(auth.jwt() ->> 'email', '') = 'OWNER_EMAIL_PLACEHOLDER__CONFIGURE_SECURELY';
$function$;

create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  set search_path to ''
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

alter table "public"."invoices"
  add constraint "invoices_client_id_fkey" foreign key (client_id) references public.clients(id) on delete restrict;

alter table "public"."invoice_line_items"
  add constraint "invoice_line_items_invoice_id_fkey" foreign key (invoice_id) references public.invoices(id) on delete cascade;

create view "public"."clients_with_totals" with (security_invoker=on) AS  SELECT c.id,
    c.name,
    c.street,
    c.postal_code,
    c.city,
    c.email,
    c.created_at,
    c.updated_at,
    (COALESCE(sum(i.total) FILTER (WHERE (i.status <> 'draft'::public.invoice_status)), (0)::numeric))::numeric(12,2) AS total_invoiced
   FROM (public.clients c
     LEFT JOIN public.invoices i ON ((i.client_id = c.id)))
  GROUP BY c.id;

create index invoice_line_items_invoice_id_idx on public.invoice_line_items using btree (invoice_id, "position");

create index invoices_client_id_idx on public.invoices using btree (client_id);

create index invoices_date_idx on public.invoices using btree (date desc);

create index invoices_status_idx on public.invoices using btree (status);

create trigger business_settings_updated_at
  before update on public.business_settings
  for each row
  execute function public.set_updated_at();

create trigger clients_updated_at
  before update on public.clients
  for each row
  execute function public.set_updated_at();

create trigger invoices_updated_at
  before update on public.invoices
  for each row
  execute function public.set_updated_at();

create policy "owner full access" on "public"."business_settings"
  for all
  to "authenticated"
  using (public.is_owner())
  with check (public.is_owner());

create policy "owner full access" on "public"."clients"
  for all
  to "authenticated"
  using (public.is_owner())
  with check (public.is_owner());

create policy "owner full access" on "public"."invoice_line_items"
  for all
  to "authenticated"
  using (public.is_owner())
  with check (public.is_owner());

create policy "owner full access" on "public"."invoices"
  for all
  to "authenticated"
  using (public.is_owner())
  with check (public.is_owner());

grant execute on function "public"."is_owner"() to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."set_updated_at"() to public, "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."business_settings" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."clients" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."invoice_line_items" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."invoices" to "anon", "authenticated", "postgres", "service_role";

grant usage on type "public"."invoice_status" to "postgres";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."clients_with_totals" to "anon", "authenticated", "postgres", "service_role";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "anon";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "authenticated";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "service_role";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "anon";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "authenticated";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "service_role";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "anon";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "authenticated";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "service_role";
