# -*- coding: utf-8 -*-
"""Minecore — puente A4 hacia la Epson de bodega (proceso aparte del de etiquetas).

Usa el MISMO vínculo del puente DYMO (~/.minecore-dymo/bridge.conf, solo lectura).
No toca bridge.py, la cola DYMO ni su LaunchAgent. Python 2.7 (Catalina) o 3.
No abre puertos, no imprime el token y solo ejecuta lp / lpstat.
"""
from __future__ import print_function

import hashlib
import io
import json
import os
import py_compile
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time

try:
    from urllib.request import Request, urlopen
    from urllib.parse import urlsplit
except ImportError:
    from urllib2 import Request, urlopen
    from urlparse import urlsplit

VERSION = "a4-1.0.0"
ALLOWED_HOSTS = ("bklbvwpkrdaojbezljsd.supabase.co",)
CA_FILES = ("/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt")
HOME = os.path.expanduser("~/.minecore-dymo")
CONF = os.path.join(HOME, "bridge.conf")          # del puente DYMO, solo lectura
A4DIR = os.path.join(HOME, "a4")
A4CONF = os.path.join(A4DIR, "a4.conf")           # opcional: A4_QUEUE=<cola>
STATE = os.path.join(A4DIR, "update.json")
BAD = os.path.join(A4DIR, "bad_versions.txt")
MAX_BYTES = 15 * 1024 * 1024
MAX_COPIES = 5
POLL_S = 10
QUEUE_RX = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
CUPS_ID_RX = re.compile(r"request id is\s+([A-Za-z0-9_.-]+)", re.I)
EPSON_RX = re.compile(r"epson|l4260", re.I)
NOT_A4_RX = re.compile(r"dymo|labelwriter|450|rr[_ -]?70|scan", re.I)
OFFLINE_WORDS = ("disabled", "offline", "not responding", "unable to connect", "cannot connect", "unreachable", "not available", "paused")


class BridgeTimeout(Exception):
    pass


def u_text(v):
    if v is None:
        return u""
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    try:
        return unicode(v)  # noqa: F821  (py2)
    except NameError:
        return str(v)


def read_kv(path):
    out = {}
    if not os.path.isfile(path):
        return out
    with io.open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def load_config():
    data = read_kv(CONF)
    token = data.get("BRIDGE_TOKEN", "")
    if len(token) < 16:
        raise RuntimeError("sin_vinculo")
    base = data.get("API_BASE") or ("https://%s/functions/v1/ventas-api" % ALLOWED_HOSTS[0])
    parts = urlsplit(base)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS or parts.username or parts.password:
        raise RuntimeError("host_no_permitido")
    local_q = read_kv(A4CONF).get("A4_QUEUE", "")
    return {"token": token, "api_base": base, "local_queue": local_q if QUEUE_RX.match(local_q or "") else ""}


def default_run(argv, timeout):
    if not isinstance(argv, list) or not argv or argv[0] not in ("lp", "lpstat"):
        raise ValueError("comando")
    env = dict(os.environ)
    env["LANG"] = "C"
    env["LC_ALL"] = "C"
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    killed = {"v": False}

    def kill():
        killed["v"] = True
        try:
            proc.kill()
        except OSError:
            pass

    timer = threading.Timer(timeout, kill)
    timer.start()
    out, err = proc.communicate()
    timer.cancel()
    if killed["v"]:
        raise BridgeTimeout(argv[0])
    return proc.returncode, u_text(out), u_text(err)


def list_printers(run):
    """[{name,state,uri,default}] de lo que ve CUPS en este Mac."""
    printers = {}
    try:
        _c, out, _e = run(["lpstat", "-l", "-p"], 15)
    except Exception:
        out = ""
    cur = None
    for line in (out or "").splitlines():
        m = re.match(r"^printer\s+(\S+)\s+(.*)$", line)
        if m:
            cur = m.group(1)
            rest = m.group(2).lower()
            state = "disabled" if "disabled" in rest else ("printing" if "printing" in rest or "now printing" in rest else ("idle" if "idle" in rest else rest[:30]))
            printers[cur] = {"name": cur, "state": state, "msg": "", "uri": "", "default": False}
        elif cur and line.strip():
            printers[cur]["msg"] = (printers[cur]["msg"] + " " + line.strip())[:300]
    try:
        _c, out, _e = run(["lpstat", "-v"], 15)
        for line in (out or "").splitlines():
            m = re.match(r"^device for\s+(\S+?):\s+(\S+)", line)
            if m and m.group(1) in printers:
                printers[m.group(1)]["uri"] = m.group(2)
    except Exception:
        pass
    try:
        _c, out, _e = run(["lpstat", "-d"], 15)
        m = re.search(r"destination:\s*(\S+)", out or "")
        if m and m.group(1) in printers:
            printers[m.group(1)]["default"] = True
    except Exception:
        pass
    return [printers[k] for k in sorted(printers)]


def is_online(p):
    if not p:
        return False
    text = (p.get("state", "") + " " + p.get("msg", "")).lower()
    for w in OFFLINE_WORDS:
        if w in text:
            return False
    return p.get("state") in ("idle", "printing")


def pick_queue(printers, local_q, server_q):
    names = dict((p["name"], p) for p in printers)
    for q in (local_q, server_q):
        if q and q in names:
            return names[q]
    cands = [p for p in printers if (EPSON_RX.search(p["name"]) or EPSON_RX.search(p.get("uri", ""))) and not NOT_A4_RX.search(p["name"])]
    if not cands:
        return None

    def score(p):
        s = 0
        if "l4260" in (p["name"] + p.get("uri", "")).lower():
            s += 4
        if is_online(p):
            s += 2
        if p.get("default"):
            s += 1
        return -s, p["name"]
    return sorted(cands, key=score)[0]


def https_context():
    ctx = ssl.create_default_context()
    for path in CA_FILES:
        if os.path.isfile(path):
            ctx.load_verify_locations(path)
            break
    return ctx


def post(cfg, op, body):
    payload = dict(body or {})
    payload["op"] = op
    req = Request(cfg["api_base"], data=json.dumps(payload).encode("utf-8"))
    req.add_header("Content-Type", "application/json")
    req.add_header("x-etiq-bridge", cfg["token"])
    res = urlopen(req, timeout=40, context=https_context())
    try:
        raw = res.read()
    finally:
        res.close()
    data = json.loads(u_text(raw))
    if not isinstance(data, dict):
        raise RuntimeError("respuesta")
    if not data.get("ok"):
        raise RuntimeError(u_text(data.get("code") or "error"))
    return data


def download(url, expect_sha, max_bytes):
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS or parts.username or parts.password:
        raise RuntimeError("url_no_permitida")
    res = urlopen(Request(url), timeout=60, context=https_context())
    try:
        blob = res.read(max_bytes + 1)
    finally:
        res.close()
    if len(blob) > max_bytes:
        raise RuntimeError("pdf_grande")
    if blob[:1024].find(b"%PDF-") < 0:
        raise RuntimeError("no_es_pdf")
    if hashlib.sha256(blob).hexdigest() != expect_sha:
        raise RuntimeError("sha_distinto")
    return blob


def safe_title(t):
    t = re.sub(r"[^A-Za-z0-9 ._-]", "_", u_text(t))[:80].strip()
    return t or "Minecore"


def submit(queue, pdf, copies, title, run):
    if not QUEUE_RX.match(queue or ""):
        return {"outcome": "send_error", "cups_job_id": ""}
    fd, path = tempfile.mkstemp(prefix="mc-a4-", suffix=".pdf")
    try:
        os.write(fd, pdf)
        os.close(fd)
        fd = None
        argv = ["lp", "-d", queue, "-n", str(copies), "-t", safe_title(title), "-o", "media=A4", "-o", "fit-to-page", path]
        try:
            code, out, err = run(argv, 60)
        except BridgeTimeout:
            return {"outcome": "ambiguous", "cups_job_id": ""}
        m = CUPS_ID_RX.search((out or "") + "\n" + (err or ""))
        cups = m.group(1) if m else ""
        if code == 0 and cups:
            return {"outcome": "accepted", "cups_job_id": cups}
        if code == 0 or cups:
            return {"outcome": "ambiguous", "cups_job_id": cups}
        return {"outcome": "send_error", "cups_job_id": ""}
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            os.remove(path)
        except OSError:
            pass


def cups_jobs(queue, which, run):
    try:
        _c, out, _e = run(["lpstat", "-W", which, "-o", queue], 15)
    except Exception:
        return None
    return set(re.findall(r"^(\S+)\s", out or "", re.M))


def track(cfg, queue, run, transport, seen):
    """Avisa cuando CUPS del iMac terminó de mandar el PDF a la Epson."""
    pend = (transport("doc_pending", {}) or {}).get("jobs") or []
    if not pend:
        return
    open_ids = cups_jobs(queue, "not-completed", run)
    done_ids = cups_jobs(queue, "completed", run)
    if open_ids is None:
        return
    now = time.time()
    for j in pend:
        cid = u_text(j.get("cups_job_id"))
        jid = j.get("id")
        if not cid:
            continue
        if cid in open_ids:
            first = seen.setdefault(jid, now)
            if now - first > 600:
                transport("doc_progress", {"job_id": jid, "cups_state": "atascado"})
        elif done_ids is not None and cid in done_ids:
            transport("doc_progress", {"job_id": jid, "cups_state": "completado"})
            seen.pop(jid, None)
        else:
            transport("doc_progress", {"job_id": jid, "cups_state": "completado"})
            seen.pop(jid, None)


def read_json(path, default):
    try:
        with io.open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def write_json(path, data):
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as fh:
        fh.write(u_text(json.dumps(data)))
    os.rename(tmp, path)


def bad_versions():
    try:
        with io.open(BAD, "r", encoding="utf-8") as fh:
            return set(x.strip() for x in fh if x.strip())
    except Exception:
        return set()


def boot_guard(me):
    """Si la versión nueva no logra un latido en 3 arranques, vuelve sola a la anterior."""
    st = read_json(STATE, None)
    if not st or st.get("confirmed"):
        return
    st["boots"] = int(st.get("boots", 0)) + 1
    if st["boots"] > 3 and os.path.isfile(me + ".bak"):
        shutil.copyfile(me + ".bak", me)
        with io.open(BAD, "a", encoding="utf-8") as fh:
            fh.write(u_text(st.get("new", "")) + u"\n")
        os.remove(STATE)
        sys.stdout.write("a4: version %s no arranco, se volvio a %s\n" % (st.get("new"), st.get("prev")))
        sys.exit(0)
    write_json(STATE, st)


def confirm_boot():
    st = read_json(STATE, None)
    if st and not st.get("confirmed"):
        os.remove(STATE)


def self_update(cfg, transport, offer, me):
    ver = u_text(offer.get("version"))
    if not ver or ver == VERSION or ver in bad_versions():
        return False
    data = transport("doc_update_get", {"version": VERSION})
    code = data.get("code")
    sha = u_text(data.get("sha256"))
    if u_text(data.get("version")) != ver or not isinstance(code, (type(u""), str)):
        return False
    blob = code.encode("utf-8") if not isinstance(code, bytes) else code
    if hashlib.sha256(blob).hexdigest() != sha or len(blob) > 400000 or b"VERSION = " not in blob:
        return False
    new = me + ".new"
    with open(new, "wb") as fh:
        fh.write(blob)
    cfile = new + ".chk"
    try:
        py_compile.compile(new, cfile=cfile, doraise=True)
    except Exception:
        if os.path.exists(cfile):
            os.remove(cfile)
        os.remove(new)
        with io.open(BAD, "a", encoding="utf-8") as fh:
            fh.write(ver + u"\n")
        return False
    if os.path.exists(cfile):
        os.remove(cfile)
    shutil.copyfile(me, me + ".bak")
    os.rename(new, me)
    write_json(STATE, {"prev": VERSION, "new": ver, "boots": 0, "confirmed": False})
    sys.stdout.write("a4: actualizado %s -> %s, reiniciando\n" % (VERSION, ver))
    return True


def step(cfg, run, transport, ctx):
    printers = list_printers(run)
    chosen = pick_queue(printers, cfg["local_queue"], ctx.get("server_q"))
    online = is_online(chosen)
    detail = "" if chosen else "no_veo_epson"
    hb = transport("doc_heartbeat", {
        "version": VERSION,
        "a4_queue": chosen["name"] if chosen else "",
        "a4_online": bool(online),
        "printers": [{"name": p["name"], "state": "lista" if is_online(p) else (p["state"] or "?"), "uri": p.get("uri", "")} for p in printers],
        "detail": detail if online or not chosen else ("cola_" + chosen["state"]),
    })
    ctx["server_q"] = u_text(hb.get("queue_pref") or "") or None
    if not ctx.get("confirmed"):
        confirm_boot()
        ctx["confirmed"] = True
    if hb.get("update") and self_update(cfg, transport, hb["update"], ctx["me"]):
        return "updated"
    if not online:
        return "printer_offline"
    claimed = transport("doc_claim", {})
    job = claimed.get("job")
    if job:
        outcome = {"outcome": "send_error", "cups_job_id": ""}
        try:
            copies = int(job.get("copies") or 1)
            if copies < 1 or copies > MAX_COPIES:
                raise RuntimeError("copias")
            pdf = download(u_text(job.get("pdf_url")), u_text(job.get("sha256")), MAX_BYTES)
            outcome = submit(chosen["name"], pdf, copies, job.get("title"), run)
        except Exception as exc:
            outcome = {"outcome": "bad_pdf" if u_text(exc) in ("sha_distinto", "no_es_pdf", "pdf_grande") else "send_error", "cups_job_id": ""}
        transport("doc_report", {"job_id": job.get("id"), "attempt_id": claimed.get("attempt_id"), "outcome": outcome["outcome"], "cups_job_id": outcome.get("cups_job_id") or ""})
    ctx["tick"] = ctx.get("tick", 0) + 1
    if ctx["tick"] % 3 == 0:
        track(cfg, chosen["name"], run, transport, ctx.setdefault("seen", {}))
    return "ok"


def main(argv):
    me = os.path.abspath(__file__)
    if len(argv) == 2 and argv[1] == "--detectar":
        printers = list_printers(default_run)
        cfg_q = read_kv(A4CONF).get("A4_QUEUE", "")
        chosen = pick_queue(printers, cfg_q, None)
        for p in printers:
            sys.stdout.write("%s  [%s]%s %s\n" % (p["name"], p["state"], " (predeterminada)" if p.get("default") else "", p.get("uri", "")))
        sys.stdout.write("Cola A4 elegida: %s (%s)\n" % (chosen["name"] if chosen else "NINGUNA", "en linea" if is_online(chosen) else "fuera de linea"))
        return 0
    if len(argv) > 1:
        raise SystemExit("uso: docbridge.py [--detectar]")
    boot_guard(me)
    ctx = {"me": me}
    while True:
        try:
            cfg = load_config()

            def transport(op, body):
                return post(cfg, op, body)
            if step(cfg, default_run, transport, ctx) == "updated":
                return 0
        except Exception as exc:
            sys.stdout.write("a4: %s %s\n" % (exc.__class__.__name__, u_text(exc)[:80]))
        try:
            sys.stdout.flush()
        except Exception:
            pass
        time.sleep(POLL_S)


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
