-- NO APLICADO. No ejecutar contra el proyecto Supabase desde este cambio.
-- Destino, cuando haya despliegue autorizado de ventas-api: esquema app
-- (proyecto bklbvwpkrdaojbezljsd). Sin políticas para anon ni authenticated.
-- El navegador no recibe la credencial del servidor. El puente usa un token
-- propio, revocable, guardado solo como hash.

create table if not exists app.etiq_jobs (
  id uuid primary key,
  ov_id uuid not null,
  order_number text not null default '',
  requested_by text not null,
  idempotency_key text not null,
  intent text not null check (intent in ('print', 'reprint', 'retry')),
  status text not null check (status in ('queued', 'claimed', 'accepted_by_cups', 'send_error', 'ambiguous')),
  profile text not null default 'clientes' check (profile = 'clientes'),
  width_mm numeric not null default 51,
  height_mm numeric not null default 19,
  paper text not null default '30330',
  labels jsonb not null,
  cups_job_id text,
  claim_token uuid,
  claimed_by text,
  attempt_id uuid,
  reprint_of uuid,
  retry_of uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requested_by, idempotency_key)
);

create table if not exists app.etiq_bridge (
  id text primary key,
  token_hash text not null unique,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  printer_online boolean,
  created_by text not null
);

alter table app.etiq_jobs enable row level security;
alter table app.etiq_bridge enable row level security;
-- Sin políticas: el rol de la API del navegador no lee ni escribe estas tablas.
-- La función de servidor, con su credencial de proceso, es la única que entra.
