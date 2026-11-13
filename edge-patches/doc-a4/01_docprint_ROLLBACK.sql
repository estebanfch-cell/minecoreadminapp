-- Rollback t1958 (solo si no hay trabajos pdf_a4 que conservar)
delete from app.etiq_jobs where kind='pdf_a4';
alter table app.etiq_jobs drop constraint if exists etiq_jobs_pdf_check;
alter table app.etiq_jobs drop constraint if exists etiq_jobs_kind_check;
alter table app.etiq_jobs drop constraint if exists etiq_jobs_profile_check;
alter table app.etiq_jobs add constraint etiq_jobs_profile_check check (profile = 'clientes');
drop index if exists app.etiq_jobs_kind_status;
alter table app.etiq_jobs drop column if exists kind, drop column if exists pdf_path, drop column if exists pdf_sha256, drop column if exists pdf_bytes, drop column if exists pdf_pages, drop column if exists copies, drop column if exists doc_kind, drop column if exists doc_title, drop column if exists source, drop column if exists cups_state, drop column if exists printer_queue;
alter table app.etiq_bridge drop column if exists a4_queue, drop column if exists a4_queue_pref, drop column if exists a4_online, drop column if exists a4_seen_at, drop column if exists a4_printers, drop column if exists a4_version, drop column if exists a4_detail;
drop table if exists app.doc_sender; drop table if exists app.doc_pair; drop table if exists app.doc_bridge_release;
