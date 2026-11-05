/**
 * Cola de etiquetas Clientes. Lógica de referencia para ventas-api.
 * NO está desplegada en Supabase. No abre puertos ni guarda secretos.
 */
import { CLIENTES, FORBIDDEN_JOB_KEYS } from './label-contract.mjs';

export const STALE_MS = 45000;
export const CLAIM_STALE_MS = 120000;

const PREP = /^(inventario|cotizaciones|picking|entrega)\+?$/;
const FINE = /^@(picking|entrega|inventario|ventas)=[123]$/;

export function permiteEtiq(actor) {
  if (!actor || actor.rol === 'cliente' || actor.rol === 'proveedor') return false;
  const m = actor.modulos || [];
  if (m.indexOf('~prep.e.etiq=1') < 0) return false;
  return m.some(function (x) { return PREP.test(x) || FINE.test(x); });
}

export function buildLabels(ov) {
  const out = [];
  (ov && ov.lineas || []).forEach(function (l) {
    if (!l || l.item_type === 'service') return;
    if (!l.sku && !l.nombre && !l.description) return;
    const qty = Number(l.cantidad != null ? l.cantidad : (l.pendiente != null ? l.pendiente : l.quantity));
    if (!(qty > 0)) return;
    out.push({
      profile: CLIENTES.profile,
      width_mm: CLIENTES.width_mm,
      height_mm: CLIENTES.height_mm,
      paper: CLIENTES.paper,
      copies: 1,
      fields: {
        nombre: String(l.nombre || l.description || ''),
        sku: String(l.sku || ''),
        qty: String(qty),
        ov: String(ov.order_number || ''),
        barcode: String(l.sku || '')
      }
    });
  });
  return out;
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function forbiddenKey(body) {
  if (!body || typeof body !== 'object') return null;
  for (const k of Object.keys(body)) {
    if (FORBIDDEN_JOB_KEYS.indexOf(k) >= 0) return k;
  }
  return null;
}

function bridgeFresh(beat, now) {
  return !!(beat && (now - beat.at) <= STALE_MS);
}

function printerOf(beat, now) {
  if (!bridgeFresh(beat, now)) return 'desconocida';
  return beat.printer_online ? 'lista' : 'offline';
}

function bridgeOf(beat, now) {
  return bridgeFresh(beat, now) ? 'conectado' : 'desconectado';
}

function view(job) {
  return {
    id: job.id,
    ov_id: job.ov_id,
    order_number: job.order_number,
    status: job.status,
    intent: job.intent,
    reprint: job.intent === 'reprint',
    cups_job_id: job.cups_job_id || null,
    physically_printed: false,
    labels: job.labels
  };
}

function pack(repo, now, extra) {
  const beat = repo.heartbeat();
  const job = extra.job ? view(extra.job) : null;
  return Object.assign({
    ok: true,
    etiq: 1,
    physically_printed: false,
    bridge: bridgeOf(beat, now),
    printer: printerOf(beat, now),
    job: job
  }, extra, { job: job, physically_printed: false });
}

function fail(code, extra) {
  return Object.assign({ ok: false, code: code, physically_printed: false }, extra || {});
}

function actorOk(repo, ctx, ov) {
  const actor = ctx.actor;
  if (!actor || !permiteEtiq(actor)) return fail('sin_permiso');
  if (typeof ctx.canOv !== 'function' || !ov || !ctx.canOv(actor, ov)) return fail('ov_ajena');
  return null;
}

function stillOk(repo, ctx, job) {
  const actor = repo.actor(job.requested_by);
  const ov = repo.ov(job.ov_id);
  if (!actor || !permiteEtiq(actor)) return false;
  if (typeof ctx.canOv !== 'function' || !ov || !ctx.canOv(actor, ov)) return false;
  return true;
}

export function createService(repo) {
  function handle(op, body, ctx) {
    return repo.tx(function () {
      const now = ctx && ctx.now ? ctx.now() : Date.now();
      body = body || {};
      ctx = ctx || {};
      const bad = forbiddenKey(body);
      if (bad) return fail('entrada_rechazada', { key: bad });

      if (op === 'heartbeat' || op === 'claim' || op === 'report') {
        const b = ctx.bridge;
        if (!b || b.role !== 'bridge' || !b.id || b.revoked || b.credential !== 'bridge_token') {
          return fail('puente_revocado');
        }
      }

      if (op === 'heartbeat') {
        repo.setHeartbeat({
          id: ctx.bridge.id,
          at: now,
          printer_online: !!body.printer_online
        });
        return pack(repo, now, { job: null });
      }

      if (op === 'enqueue' || op === 'retry' || op === 'reprint') {
        return enqueue(op, body, ctx, repo, now);
      }
      if (op === 'status') return status(body, ctx, repo, now);
      if (op === 'claim') return claim(ctx, repo, now);
      if (op === 'report') return report(body, ctx, repo, now);
      return fail('op_desconocida');
    });
  }
  return { handle: handle };
}

function enqueue(op, body, ctx, repo, now) {
  const intent = op === 'reprint' ? 'reprint' : (op === 'retry' ? 'retry' : (body.intent || 'print'));
  if (intent !== 'print' && intent !== 'reprint' && intent !== 'retry') return fail('entrada_rechazada');

  let ov = null;
  let parent = null;
  if (intent === 'print') {
    ov = repo.ov(body.ov_id);
    const gate = actorOk(repo, ctx, ov);
    if (gate) return gate;
    const key = String(body.idempotency_key || '');
    if (!key || key.length > 200) return fail('entrada_rechazada');
    const prev = repo.findJobByKey(ctx.actor.id, key);
    if (prev) return pack(repo, now, { job: prev, duplicate: true });
    const labels = buildLabels(ov);
    if (!labels.length) return fail('nada_que_imprimir');
    const job = newJob({
      ov: ov,
      actor: ctx.actor,
      key: key,
      intent: 'print',
      labels: labels,
      now: now
    });
    repo.insertJob(job);
    return pack(repo, now, { job: job, duplicate: false });
  }

  parent = repo.getJob(body.job_id);
  if (!parent) return fail('ov_ajena');
  ov = repo.ov(parent.ov_id);
  const gate2 = actorOk(repo, ctx, ov);
  if (gate2) return gate2;
  const key2 = String(body.idempotency_key || '');
  if (!key2 || key2.length > 200) return fail('entrada_rechazada');
  const prev2 = repo.findJobByKey(ctx.actor.id, key2);
  if (prev2) return pack(repo, now, { job: prev2, duplicate: true });

  if (intent === 'retry') {
    if (!body.confirm) return fail('confirma_reintento', { job_id: parent.id, status: parent.status });
    const beat = repo.heartbeat();
    const staleClaim = parent.status === 'claimed' && (!beat || (now - beat.at) > CLAIM_STALE_MS);
    const retryable = parent.status === 'ambiguous' || parent.status === 'send_error' || staleClaim;
    if (parent.status === 'accepted_by_cups') return fail('no_reintento', { job_id: parent.id });
    if (!retryable) return fail('no_reintento', { job_id: parent.id, status: parent.status });
    if (staleClaim) {
      parent.status = 'ambiguous';
      parent.updated_at = now;
      repo.updateJob(parent);
    }
  } else {
    if (!body.confirm) return fail('confirma_reimpresion', { job_id: parent.id });
    if (parent.status !== 'accepted_by_cups' && parent.status !== 'send_error' && parent.status !== 'ambiguous') {
      return fail('no_reintento', { job_id: parent.id, status: parent.status });
    }
  }

  const job = newJob({
    ov: ov,
    actor: ctx.actor,
    key: key2,
    intent: intent,
    labels: parent.labels,
    now: now,
    link: parent.id
  });
  repo.insertJob(job);
  return pack(repo, now, { job: job, duplicate: false, parent_status: parent.status });
}

function newJob(o) {
  const job = {
    id: uuid(),
    ov_id: o.ov.id,
    order_number: o.ov.order_number || '',
    requested_by: o.actor.id,
    idempotency_key: o.key,
    intent: o.intent,
    status: 'queued',
    profile: CLIENTES.profile,
    labels: o.labels,
    physically_printed: false,
    cups_job_id: null,
    claim_token: null,
    claimed_by: null,
    attempt_id: null,
    reprint_of: o.intent === 'reprint' ? o.link : null,
    retry_of: o.intent === 'retry' ? o.link : null,
    created_at: o.now,
    updated_at: o.now
  };
  return job;
}

function status(body, ctx, repo, now) {
  const job = repo.getJob(body.job_id);
  if (!job) return fail('ov_ajena');
  const ov = repo.ov(job.ov_id);
  const gate = actorOk(repo, ctx, ov);
  if (gate) return gate;
  return pack(repo, now, { job: job, duplicate: false });
}

function claim(ctx, repo, now) {
  const beat0 = repo.heartbeat();
  if (!beat0 || !bridgeFresh(beat0, now) || beat0.id !== ctx.bridge.id) {
    return pack(repo, now, { job: null, held: 'sin_latido' });
  }
  if (!beat0.printer_online) {
    return pack(repo, now, { job: null, held: 'impresora_offline' });
  }
  repo.setHeartbeat({ id: ctx.bridge.id, at: now, printer_online: true });
  const queued = repo.queued();
  for (let i = 0; i < queued.length; i++) {
    const job = queued[i];
    if (!stillOk(repo, ctx, job)) continue;
    job.status = 'claimed';
    job.claimed_by = ctx.bridge.id;
    job.claim_token = uuid();
    job.attempt_id = uuid();
    job.updated_at = now;
    repo.updateJob(job);
    return pack(repo, now, { job: job, attempt_id: job.attempt_id, duplicate: false });
  }
  return pack(repo, now, { job: null });
}

function report(body, ctx, repo, now) {
  const job = repo.getJob(body.job_id);
  if (!job) return fail('ov_ajena');
  if (job.claimed_by !== ctx.bridge.id || job.attempt_id !== body.attempt_id) {
    return fail('intento_no_coincide', { job_id: job.id, status: job.status });
  }
  const outcome = body.outcome;
  if (outcome === 'printer_offline') {
    job.status = 'queued';
    job.claimed_by = null;
    job.claim_token = null;
    job.attempt_id = null;
    job.updated_at = now;
    repo.updateJob(job);
    const prev = repo.heartbeat() || { id: ctx.bridge.id, at: now };
    repo.setHeartbeat({ id: ctx.bridge.id, at: now, printer_online: false });
    return pack(repo, now, { job: job });
  }
  if (outcome === 'send_error') {
    job.status = 'send_error';
    job.cups_job_id = null;
    job.updated_at = now;
    repo.updateJob(job);
    return pack(repo, now, { job: job });
  }
  if (outcome === 'accepted') {
    const cups = String(body.cups_job_id || '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(cups)) {
      job.status = 'ambiguous';
      job.cups_job_id = null;
      job.updated_at = now;
      repo.updateJob(job);
      return pack(repo, now, { job: job });
    }
    job.status = 'accepted_by_cups';
    job.cups_job_id = cups;
    job.physically_printed = false;
    job.updated_at = now;
    repo.updateJob(job);
    return pack(repo, now, { job: job });
  }
  if (outcome === 'ambiguous') {
    job.status = 'ambiguous';
    job.cups_job_id = body.cups_job_id && /^[A-Za-z0-9_-]{1,80}$/.test(body.cups_job_id) ? body.cups_job_id : null;
    job.updated_at = now;
    repo.updateJob(job);
    return pack(repo, now, { job: job });
  }
  return fail('entrada_rechazada');
}

export function memoryRepo() {
  const jobs = [];
  const ovs = new Map();
  const actors = new Map();
  let beat = null;
  let chain = Promise.resolve();
  return {
    jobs: jobs,
    putOv: function (ov) { ovs.set(ov.id, ov); },
    putActor: function (a) { actors.set(a.id, a); },
    ov: function (id) { return ovs.get(id) || null; },
    actor: function (id) { return actors.get(id) || null; },
    heartbeat: function () { return beat; },
    setHeartbeat: function (b) { beat = { id: b.id, at: b.at, printer_online: !!b.printer_online }; },
    findJobByKey: function (userId, key) {
      return jobs.filter(function (j) { return j.requested_by === userId && j.idempotency_key === key; })[0] || null;
    },
    insertJob: function (job) { jobs.push(job); },
    updateJob: function (job) {
      const i = jobs.findIndex(function (j) { return j.id === job.id; });
      if (i >= 0) jobs[i] = job;
    },
    getJob: function (id) { return jobs.filter(function (j) { return j.id === id; })[0] || null; },
    queued: function () {
      return jobs.filter(function (j) { return j.status === 'queued'; })
        .sort(function (a, b) { return a.created_at - b.created_at; });
    },
    tx: function (fn) {
      const prev = chain;
      let release;
      chain = new Promise(function (res) { release = res; });
      return prev.then(function () {
        try { return fn(); }
        finally { release(); }
      });
    }
  };
}
