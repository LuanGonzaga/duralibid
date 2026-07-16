create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_event_at timestamptz,
  funnel_status text not null default 'checkout_visit',
  payment_status text,
  payment_method text,
  payment_id text unique,
  kit_id integer,
  kit_name text,
  amount numeric(10,2),
  name text,
  email text,
  phone text,
  cpf text,
  zip_code text,
  street text,
  number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  pix_code text,
  pix_generated_at timestamptz,
  pix_expires_at timestamptz,
  recovery_stage integer not null default 0,
  recovery_last_sent_at timestamptz,
  paid_at timestamptz,
  attribution jsonb not null default '{}'::jsonb,
  tracking jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists leads_funnel_status_idx on public.leads (funnel_status);
create index if not exists leads_payment_id_idx on public.leads (payment_id);
create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_recovery_idx on public.leads (funnel_status, payment_method, recovery_stage, created_at);

alter table public.leads enable row level security;

drop policy if exists "service role can manage leads" on public.leads;
create policy "service role can manage leads"
on public.leads
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
