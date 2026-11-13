// t1958 Impresión remota A4 (Epson L4260 bodega). Mismo puente/token que la DYMO, pero ops propias:
// las etiquetas no cambian. Interruptor ~doc.e.imprimir=1 (default apagado). No llama a inFlow.
// Nunca recibe comandos, colas ni URLs del navegador: el puente elige la cola Epson que él mismo ve.
const SB = Deno.env.get("SUPABASE_URL"), SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = "inflow";
const PREFIX = "print-a4";
export const DOC_PERM = "~doc.e.imprimir=1";
export const MAX_BYTES = 15 * 1024 * 1024;
export const MAX_PAGES = 30;
export const MAX_COPIES = 5;
const A4_STALE_MS = 75000;
// PDFs que NO llevan precios (los únicos que ve un usuario con $precios=0).
export const SIN_PRECIOS = new Set(["picklist", "boxcontent", "acta", "packing", "prep", "oc_sinprecio", "conteo", "entrega", "despiece", "ficha"]);
export const KINDS = new Set([...SIN_PRECIOS, "cotizacion", "ov", "factura", "oc", "estado_cuenta", "costeo", "propuesta", "resumen", "planilla", "liquidacion", "consignacion", "otro", "mac"]);
const FORBIDDEN = ["url", "cmd", "shell", "cups_queue", "lp", "argv", "printer", "destination", "queue", "labels", "pdf_path"];
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function rand(n, alphabet) { const b = new Uint8Array(n); crypto.getRandomValues(b); let s = ""; for (const x of b) s += alphabet[x % alphabet.length]; return s; }
export async function sha256Hex(data) {
  const d = await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function docPerm(sql, actor) {
  const [u] = await sql`select nombre, rol, modulos, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${String(actor || "")}) limit 1`;
  if (!u || u.activo === false || u.rol === "cliente" || u.rol === "proveedor") return null;
  const m = Array.isArray(u.modulos) ? u.modulos.map(String) : [];
  if (!m.includes(DOC_PERM)) return null;
  return { nombre: u.nombre, admin: u.rol === "admin", precios: !m.includes("$precios=0"), costos: !m.includes("$costos=0") };
}
function latin1(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768))); return s; }
async function inflate(bytes) {
  try {
    const ds = new DecompressionStream("deflate");
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  } catch { return null; }
}
// Texto + diccionarios del PDF, incluidos los streams FlateDecode (máx. 400 streams / 40 MB inflados).
export async function pdfScan(bytes) {
  const raw = latin1(bytes);
  const parts = [raw];
  const rx = /stream\r?\n/g; let m, n = 0, total = 0;
  while ((m = rx.exec(raw)) && n < 400) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const head = raw.slice(Math.max(0, m.index - 400), m.index);
    if (/FlateDecode/.test(head.slice(head.lastIndexOf("<<")))) {
      const inf = await inflate(bytes.subarray(start, end));
      if (inf && (total += inf.length) < 40 * 1024 * 1024) parts.push(latin1(inf));
    }
    rx.lastIndex = end; n++;
  }
  const all = parts.join("\n");
  const pages = (all.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  let count = 0; for (const c of all.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)) count = Math.max(count, Number(c[1] || c[2]) || 0);
  return { pages: Math.max(pages, count), text: all };
}
// Marcas de precio en el texto dibujado. Solo se aplica a usuarios con $precios=0.
export function tienePrecios(text) {
  const tj = (text.match(/\((?:\\.|[^\\)])*\)\s*(?:Tj|')|\[(?:[^\]]*)\]\s*TJ/g) || []).join(" ");
  return /Precio|P\.\s*Unit|Subtotal|Sub-total|\bIVA\b|Valor\s+total|Total\s+a\s+pagar|\$\s*\d/i.test(tj);
}
export async function validarPdf(bytes) {
  if (!bytes || !bytes.length) fail("pdf_vacio");
  if (bytes.length > MAX_BYTES) fail("pdf_grande");
  if (latin1(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0) fail("no_es_pdf");
  const sc = await pdfScan(bytes);
  if (sc.pages < 1) fail("pdf_ilegible");
  if (sc.pages > MAX_PAGES) fail("pdf_paginas");
  return { sha: await sha256Hex(bytes), pages: sc.pages, text: sc.text };
}
async function storagePut(path, bytes) {
  const r = await fetch(`${SB}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { Authorization: "Bearer " + SK, apikey: SK, "Content-Type": "application/pdf", "x-upsert": "true" }, body: bytes });
  if (!r.ok) fail("storage_" + r.status);
}
async function signOne(path, secs) {
  const r = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${path}`, { method: "POST", headers: { Authorization: "Bearer " + SK, apikey: SK, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: secs }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) fail("storage_firma");
  return SB + "/storage/v1" + j.signedURL;
}
function limpiarTitulo(t) { return String(t || "").replace(/[\x00-\x1f\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Minecore.pdf"; }
async function a4Bridge(sql) {
  const [b] = await sql`select id, a4_seen_at, a4_online, a4_queue, a4_printers, a4_version, a4_detail from app.etiq_bridge where revoked_at is null and a4_seen_at is not null order by a4_seen_at desc limit 1`;
  if (!b) return { bridge: "sin_puente_a4", printer: "desconocida", queue: null, printers: [], version: null };
  const fresh = Date.now() - new Date(b.a4_seen_at).getTime() <= A4_STALE_MS;
  return { bridge: fresh ? "conectado" : "desconectado", printer: !fresh ? "desconocida" : b.a4_online ? "lista" : (b.a4_queue ? "offline" : "sin_cola"), queue: b.a4_queue || null,
    printers: Array.isArray(b.a4_printers) ? b.a4_printers.map((p) => ({ name: String(p.name || ""), state: String(p.state || "") })) : [], version: b.a4_version || null, detail: b.a4_detail || "", seen_at: b.a4_seen_at };
}
function viewJob(j) {
  return { id: j.id, status: j.status, cups_state: j.cups_state || null, cups_job_id: j.cups_job_id || null, title: j.doc_title, kind: j.doc_kind, copies: j.copies, pages: j.pdf_pages,
    source: j.source, requested_by: j.requested_by, created_at: j.created_at, updated_at: j.updated_at, printer_queue: j.printer_queue || null, physically_printed: false };
}
export async function encolarPdf(sql, who, bytes, { title, kind, copies, key, source }) {
  if (!KINDS.has(kind)) fail("tipo_doc");
  if (!who.precios && !SIN_PRECIOS.has(kind)) fail("sin_precios");
  if (!who.costos && kind === "costeo") fail("sin_precios");
  const nCop = Number(copies ?? 1);
  if (!Number.isInteger(nCop) || nCop < 1 || nCop > MAX_COPIES) fail("copias");
  key = String(key || "");
  if (!key || key.length > 200) fail("entrada_rechazada");
  const [prev] = await sql`select * from app.etiq_jobs where requested_by=${who.nombre} and idempotency_key=${key}`;
  if (prev) return { doc: 1, duplicate: true, job: viewJob(prev), ...(await a4Bridge(sql)) };
  const v = await validarPdf(bytes);
  if (!who.precios && tienePrecios(v.text)) fail("sin_precios");
  const path = `${PREFIX}/${new Date().toISOString().slice(0, 10)}/${v.sha.slice(0, 16)}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await storagePut(path, bytes);
  const [job] = await sql`insert into app.etiq_jobs(ov_id, order_number, requested_by, idempotency_key, intent, status, labels, kind, profile, width_mm, height_mm, paper, pdf_path, pdf_sha256, pdf_bytes, pdf_pages, copies, doc_kind, doc_title, source)
    values (${null}, ${""}, ${who.nombre}, ${key}, 'print', 'queued', ${sql.json([])}, 'pdf_a4', 'a4', 210, 297, 'A4', ${path}, ${v.sha}, ${bytes.length}, ${v.pages}, ${nCop}, ${kind}, ${limpiarTitulo(title)}, ${source}) returning *`;
  return { doc: 1, duplicate: false, job: viewJob(job), ...(await a4Bridge(sql)) };
}
function b64bytes(s) {
  try { return Uint8Array.from(atob(String(s || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "")), (c) => c.charCodeAt(0)); } catch { fail("base64"); }
}
// Ops del portal (vía portal-api, actor = sesión).
export async function docUser(op, b, sql, actor) {
  for (const k of FORBIDDEN) if (k in (b || {})) fail("entrada_rechazada");
  const who = await docPerm(sql, actor);
  if (!who) fail("sin_permiso");
  if (op === "doc_print_info") return { doc: 1, precios: who.precios, sin_precios: [...SIN_PRECIOS], max_copies: MAX_COPIES, max_pages: MAX_PAGES, max_mb: 15, ...(await a4Bridge(sql)) };
  if (op === "doc_print_enqueue") {
    return await encolarPdf(sql, who, b64bytes(b.pdf_b64), { title: b.filename, kind: String(b.doc_kind || "otro"), copies: b.copies ?? 1, key: b.idempotency_key, source: "portal" });
  }
  if (op === "doc_print_status") {
    const id = String(b.job_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail("entrada_rechazada");
    const [j] = await sql`select * from app.etiq_jobs where id=${id}::uuid and kind='pdf_a4'`;
    if (!j || (!who.admin && j.requested_by.toLowerCase() !== who.nombre.toLowerCase())) fail("no_encontrado");
    return { doc: 1, job: viewJob(j), ...(await a4Bridge(sql)) };
  }
  if (op === "doc_print_recent") {
    const rows = who.admin ? await sql`select * from app.etiq_jobs where kind='pdf_a4' order by created_at desc limit 15`
      : await sql`select * from app.etiq_jobs where kind='pdf_a4' and lower(requested_by)=lower(${who.nombre}) order by created_at desc limit 15`;
    return { doc: 1, jobs: rows.map(viewJob), ...(await a4Bridge(sql)) };
  }
  if (op === "doc_pair_begin") {
    if (!who.admin || !who.precios) fail("sin_permiso");
    const code = rand(12, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    await sql`insert into app.doc_pair(code_hash, created_by, expires_at) values (${await sha256Hex(code)}, ${who.nombre}, now() + interval '10 minutes')`;
    return { doc: 1, code, expires_min: 10 };
  }
  if (op === "doc_sender_list") {
    if (!who.admin) fail("sin_permiso");
    return { doc: 1, senders: await sql`select id, label, created_by, created_at, last_used_at, revoked_at from app.doc_sender order by created_at desc limit 20` };
  }
  if (op === "doc_sender_revoke") {
    if (!who.admin) fail("sin_permiso");
    const id = String(b.sender_id || "");
    if (!/^ds_[a-z0-9]{10}$/.test(id)) fail("entrada_rechazada");
    const r = await sql`update app.doc_sender set revoked_at=now() where id=${id} and revoked_at is null returning id`;
    return { doc: 1, revoked: r.length };
  }
  fail("op_desconocida");
}
// Mac mini «Epson Bodega (remota)»: canje del código de un solo uso.
export async function docPairFinish(sql, code, label) {
  const raw = String(code || "").trim().toUpperCase();
  if (!/^[A-Z2-9]{12}$/.test(raw)) fail("entrada_rechazada");
  const hash = await sha256Hex(raw);
  const token = rand(40, "abcdefghijklmnopqrstuvwxyz0123456789");
  const id = "ds_" + rand(10, "abcdefghijklmnopqrstuvwxyz0123456789");
  const ok = await sql.begin(async (tx) => {
    const [p] = await tx`select * from app.doc_pair where code_hash=${hash} for update`;
    if (!p || p.used_at || new Date(p.expires_at).getTime() < Date.now() || p.attempts >= 5) { if (p) await tx`update app.doc_pair set attempts=attempts+1 where code_hash=${hash}`; return false; }
    await tx`update app.doc_pair set used_at=now() where code_hash=${hash}`;
    await tx`insert into app.doc_sender(id, token_hash, created_by, label) values (${id}, ${await sha256Hex(token)}, ${p.created_by}, ${String(label || "").replace(/[^\w .-]/g, "").slice(0, 60)})`;
    return true;
  });
  if (!ok) fail("codigo_invalido");
  return { doc: 1, sender_id: id, token };
}
export async function docSenderSubmit(sql, token, bytes, title, copies, key) {
  if (!token || token.length < 32) fail("remitente_revocado");
  const [s] = await sql`select * from app.doc_sender where token_hash=${await sha256Hex(token)} and revoked_at is null`;
  if (!s) fail("remitente_revocado");
  const who = await docPerm(sql, s.created_by);
  if (!who) fail("sin_permiso");
  await sql`update app.doc_sender set last_used_at=now() where id=${s.id}`;
  return await encolarPdf(sql, who, bytes, { title, kind: "mac", copies, key: key || ("mac-" + crypto.randomUUID()), source: "mac:" + s.id });
}
// Ops del puente (mismo token del iMac, cabecera x-etiq-bridge). Proceso A4 aparte del de etiquetas.
export async function docBridge(b, sql, bridge) {
  const op = String(b.op || "");
  if (op === "doc_heartbeat") {
    const printers = (Array.isArray(b.printers) ? b.printers : []).slice(0, 30).map((p) => ({ name: String(p && p.name || "").slice(0, 80), state: String(p && p.state || "").slice(0, 40), uri: String(p && p.uri || "").replace(/\?.*$/, "").slice(0, 120) }));
    const q = String(b.a4_queue || "");
    const queue = /^[A-Za-z0-9_.-]{1,80}$/.test(q) ? q : null;
    await sql`update app.etiq_bridge set a4_seen_at=now(), a4_online=${!!b.a4_online && !!queue}, a4_queue=${queue}, a4_printers=${sql.json(printers)}, a4_version=${String(b.version || "").slice(0, 20)}, a4_detail=${String(b.detail || "").slice(0, 200)} where id=${bridge.id}`;
    const [br] = await sql`select a4_queue_pref from app.etiq_bridge where id=${bridge.id}`;
    const [rel] = await sql`select version, sha256 from app.doc_bridge_release where active limit 1`;
    return { doc: 1, queue_pref: br?.a4_queue_pref || null, update: rel && rel.version !== String(b.version || "") ? { version: rel.version, sha256: rel.sha256 } : null };
  }
  if (op === "doc_update_get") {
    const [rel] = await sql`select version, sha256, code from app.doc_bridge_release where active limit 1`;
    if (!rel) fail("sin_version");
    return { doc: 1, version: rel.version, sha256: rel.sha256, code: rel.code };
  }
  if (op === "doc_claim") {
    const [me] = await sql`select a4_seen_at, a4_online, a4_queue from app.etiq_bridge where id=${bridge.id}`;
    if (!me || !me.a4_online || !me.a4_queue || Date.now() - new Date(me.a4_seen_at).getTime() > A4_STALE_MS) return { doc: 1, job: null, held: "impresora_offline" };
    const job = await sql.begin(async (tx) => {
      const rows = await tx`select id from app.etiq_jobs where kind='pdf_a4' and status='queued' order by created_at for update skip locked limit 5`;
      for (const r of rows) {
        const [j] = await tx`select * from app.etiq_jobs where id=${r.id}`;
        const who = await docPerm(tx, j.requested_by);
        if (!who || (!who.precios && !SIN_PRECIOS.has(j.doc_kind))) { await tx`update app.etiq_jobs set status='send_error', cups_state='rechazado_permiso', updated_at=now() where id=${j.id}`; continue; }
        const [u] = await tx`update app.etiq_jobs set status='claimed', claimed_by=${bridge.id}, attempt_id=${crypto.randomUUID()}::uuid, printer_queue=${me.a4_queue}, updated_at=now() where id=${j.id} and status='queued' returning *`;
        if (u) return u;
      }
      return null;
    });
    if (!job) return { doc: 1, job: null };
    return { doc: 1, attempt_id: job.attempt_id, job: { id: job.id, copies: job.copies, pages: job.pdf_pages, bytes: job.pdf_bytes, sha256: job.pdf_sha256, title: job.doc_title, pdf_url: await signOne(job.pdf_path, 180) } };
  }
  if (op === "doc_report") {
    const [job] = await sql`select * from app.etiq_jobs where id=${String(b.job_id || "")}::uuid and kind='pdf_a4'`;
    if (!job || job.claimed_by !== bridge.id || String(job.attempt_id) !== String(b.attempt_id)) fail("intento_no_coincide");
    if (job.status !== "claimed") return { doc: 1, job: viewJob(job) };
    const outcome = String(b.outcome || "");
    const cups = String(b.cups_job_id || "");
    let u;
    if (outcome === "printer_offline") [u] = await sql`update app.etiq_jobs set status='queued', claimed_by=null, attempt_id=null, updated_at=now() where id=${job.id} returning *`;
    else if (outcome === "accepted" && /^[A-Za-z0-9_.-]{1,80}$/.test(cups)) [u] = await sql`update app.etiq_jobs set status='accepted_by_cups', cups_job_id=${cups}, cups_state='pendiente', updated_at=now() where id=${job.id} returning *`;
    else if (outcome === "send_error" || outcome === "bad_pdf") [u] = await sql`update app.etiq_jobs set status='send_error', cups_state=${outcome === "bad_pdf" ? "pdf_no_coincide" : null}, updated_at=now() where id=${job.id} returning *`;
    else [u] = await sql`update app.etiq_jobs set status='ambiguous', cups_job_id=${/^[A-Za-z0-9_.-]{1,80}$/.test(cups) ? cups : null}, updated_at=now() where id=${job.id} returning *`;
    return { doc: 1, job: viewJob(u) };
  }
  if (op === "doc_progress") {
    const st = String(b.cups_state || "");
    if (!["pendiente", "completado", "atascado", "cancelado"].includes(st)) fail("entrada_rechazada");
    const r = await sql`update app.etiq_jobs set cups_state=${st}, updated_at=now() where id=${String(b.job_id || "")}::uuid and kind='pdf_a4' and claimed_by=${bridge.id} and status='accepted_by_cups' returning id`;
    return { doc: 1, updated: r.length };
  }
  if (op === "doc_pending") {
    const rows = await sql`select id, cups_job_id, updated_at from app.etiq_jobs where kind='pdf_a4' and claimed_by=${bridge.id} and status='accepted_by_cups' and coalesce(cups_state,'pendiente') in ('pendiente','atascado') and created_at > now() - interval '2 days' order by created_at limit 20`;
    return { doc: 1, jobs: rows.map((r) => ({ id: r.id, cups_job_id: r.cups_job_id })) };
  }
  fail("op_desconocida");
}
