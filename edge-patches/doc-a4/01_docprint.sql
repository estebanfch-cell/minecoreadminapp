-- t1958 impresión remota A4 (Epson bodega). Aditivo: las etiquetas DYMO no cambian.
alter table app.etiq_jobs add column if not exists kind text not null default 'label';
alter table app.etiq_jobs add column if not exists pdf_path text;
alter table app.etiq_jobs add column if not exists pdf_sha256 text;
alter table app.etiq_jobs add column if not exists pdf_bytes int;
alter table app.etiq_jobs add column if not exists pdf_pages int;
alter table app.etiq_jobs add column if not exists copies int;
alter table app.etiq_jobs add column if not exists doc_kind text;
alter table app.etiq_jobs add column if not exists doc_title text;
alter table app.etiq_jobs add column if not exists source text;
alter table app.etiq_jobs add column if not exists cups_state text;
alter table app.etiq_jobs add column if not exists printer_queue text;
alter table app.etiq_jobs drop constraint if exists etiq_jobs_kind_check;
alter table app.etiq_jobs add constraint etiq_jobs_kind_check check (kind in ('label','pdf_a4'));
alter table app.etiq_jobs drop constraint if exists etiq_jobs_profile_check;
alter table app.etiq_jobs add constraint etiq_jobs_profile_check check (profile in ('clientes','a4'));
alter table app.etiq_jobs drop constraint if exists etiq_jobs_pdf_check;
alter table app.etiq_jobs add constraint etiq_jobs_pdf_check check (kind='label' or (pdf_path is not null and pdf_sha256 ~ '^[0-9a-f]{64}$' and pdf_bytes between 1 and 15728640 and pdf_pages between 1 and 30 and copies between 1 and 5 and profile='a4'));
create index if not exists etiq_jobs_kind_status on app.etiq_jobs(kind, status, created_at);

alter table app.etiq_bridge add column if not exists a4_queue text;
alter table app.etiq_bridge add column if not exists a4_queue_pref text;
alter table app.etiq_bridge add column if not exists a4_online boolean;
alter table app.etiq_bridge add column if not exists a4_seen_at timestamptz;
alter table app.etiq_bridge add column if not exists a4_printers jsonb;
alter table app.etiq_bridge add column if not exists a4_version text;
alter table app.etiq_bridge add column if not exists a4_detail text;

-- Remitentes «Epson Bodega (remota)» (Mac mini oficina). Token solo como hash.
create table if not exists app.doc_sender (
  id text primary key,
  token_hash text not null unique,
  created_by text not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists app.doc_pair (
  code_hash text primary key,
  created_by text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts int not null default 0
);
-- Versiones del puente A4 (autoactualización). Una sola activa.
create table if not exists app.doc_bridge_release (
  version text primary key,
  code text not null,
  sha256 text not null,
  active boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists doc_bridge_release_one_active on app.doc_bridge_release(active) where active;
alter table app.doc_sender enable row level security;
alter table app.doc_pair enable row level security;
alter table app.doc_bridge_release enable row level security;
revoke all on app.doc_sender, app.doc_pair, app.doc_bridge_release from anon, authenticated;
