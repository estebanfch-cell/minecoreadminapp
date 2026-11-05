# -*- coding: utf-8 -*-
"""Puente saliente a ventas-api y a la DYMO Wireless (perfil Clientes).

Corre en Python 2.7 o 3, el que haya en la Mac. No se validó en Catalina.
No abre puertos, no trae token y no habla con portal-api.
"""

from __future__ import print_function

import io
import json
import os
import re
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

COMPAT = {
    "declared": "Python 2.7 o 3, biblioteca estándar, CUPS lp/lpstat, HTTPS saliente a ventas-api",
    "os_target": "macOS 10.15 Catalina",
    "validated_on_target": False,
    "validated_on": "Linux CPython 3, CUPS simulado",
    "api": "https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api",
    "notes": "No impone Python 3.8 ni Homebrew. Pantalla bloqueada no detiene un LaunchAgent de la sesión. Reposo del sistema, apagado o cerrar sesión sí lo detienen.",
}

PROFILE = "clientes"
WIDTH_MM = 51.0
HEIGHT_MM = 19.0
PAPER = "30330"
FIELDS = ("nombre", "sku", "qty", "ov")
ALLOWED_HOSTS = ("bklbvwpkrdaojbezljsd.supabase.co",)
FORBIDDEN = ("url", "cmd", "shell", "cups_queue", "lp", "argv", "printer", "destination")
class BridgeTimeout(Exception):
    pass


QUEUE_RX = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
CUPS_ID_RX = re.compile(r"request id is\s+([A-Za-z0-9_-]+)", re.I)


def resolve_base(url):
    parts = urlsplit(url or "")
    host = parts.hostname or ""
    if parts.scheme != "https" or host not in ALLOWED_HOSTS:
        raise ValueError("host no permitido")
    if parts.username or parts.password:
        raise ValueError("credencial en la URL")
    path = parts.path or "/functions/v1/ventas-api"
    if path.rstrip("/") != "/functions/v1/ventas-api":
        raise ValueError("solo ventas-api")
    return "https://" + host + path


def load_config(path):
    mode = os.stat(path).st_mode & 0o777
    if mode & 0o077:
        raise ValueError("el archivo de configuración debe ser chmod 600")
    data = {}
    with io.open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()
    token = data.get("BRIDGE_TOKEN", "")
    queue = data.get("CUPS_QUEUE", "")
    if len(token) < 16:
        raise ValueError("falta BRIDGE_TOKEN")
    if not QUEUE_RX.match(queue or ""):
        raise ValueError("CUPS_QUEUE vacío o inválido")
    base = resolve_base(data.get("API_BASE") or ("https://%s/functions/v1/ventas-api" % ALLOWED_HOSTS[0]))
    return {"token": token, "queue": queue, "api_base": base}


def pdf_escape(text):
    return str(text).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def wrap_words(text, size_pt, max_w_pt):
    """Parte el texto en líneas. No descarta palabras."""
    words = str(text or "").split()
    if not words:
        return [""]
    max_chars = max(1, int(max_w_pt / max(size_pt * 0.5, 0.1)))
    lines = []
    cur = ""
    for word in words:
        trial = word if not cur else cur + " " + word
        if len(trial) <= max_chars:
            cur = trial
            continue
        if cur:
            lines.append(cur)
        while len(word) > max_chars:
            lines.append(word[:max_chars])
            word = word[max_chars:]
        cur = word
    if cur:
        lines.append(cur)
    return lines


_PAT = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split()


def code128_codes(text):
    text = "" if text is None else str(text)
    def digits_at(i):
        n = 0
        while i + n < len(text) and "0" <= text[i + n] <= "9":
            n += 1
        return n
    codes = []
    i = 0
    setb = "C" if digits_at(0) >= 4 else "B"
    codes.append(105 if setb == "C" else 104)
    while i < len(text):
        d = digits_at(i)
        if setb == "B" and d >= 4:
            if d % 2 == 1:
                codes.append(ord(text[i]) - 32)
                i += 1
            codes.append(99)
            setb = "C"
            continue
        if setb == "C" and d < 2:
            codes.append(100)
            setb = "B"
            continue
        if setb == "C":
            codes.append(int(text[i:i + 2]))
            i += 2
        else:
            c = ord(text[i])
            if c < 32 or c > 126:
                c = 32
            codes.append(c - 32)
            i += 1
    checksum = codes[0]
    for k in range(1, len(codes)):
        checksum += codes[k] * k
    codes.append(checksum % 103)
    codes.append(106)
    return codes


def code128_bars(sku, page_w, page_h):
    """Rectángulos PDF en puntos. Módulo >= 0.19 mm y zona quieta de 10 módulos."""
    codes = code128_codes(sku)
    pats = [_PAT[c] for c in codes]
    mods = 0
    for p in pats:
        for ch in p:
            mods += int(ch)
    quiet = 10
    max_w = page_w - 2 * (1.5 / 25.4 * 72.0)
    module = max_w / float(mods + quiet * 2)
    min_mod = 0.19 / 25.4 * 72.0
    if module < min_mod:
        module = min_mod
    bar_h = 6.2 / 25.4 * 72.0
    total = (mods + quiet * 2) * module
    x = (page_w - total) / 2.0 + quiet * module
    y = 1.0 / 25.4 * 72.0
    ops = []
    for p in pats:
        black = True
        for ch in p:
            ww = int(ch) * module
            if black and ww > 0:
                ops.append("%.2f %.2f %.2f %.2f re f" % (x, y, ww, bar_h))
            x += ww
            black = not black
    return ops


def place_ids(sku, qty, ov):
    """SKU y OV al mismo tamaño. Si no caben en una línea, la OV baja. Anchos en puntos."""
    gap = 1.15 / 25.4 * 72.0
    sep = 2.0 / 25.4 * 72.0
    maxw = (51.0 - 3.0) / 25.4 * 72.0

    def width(text, pt):
        return len(text) * pt * 0.52

    sz = 8.2
    while sz >= 6.4:
        sw, qw, ow = width(sku, sz), width(qty, sz), width(ov, sz)
        if sw + gap + qw + sep + ow <= maxw + 0.4:
            return 1, sz, sw, qw, ow
        sz = round(sz - 0.1, 2)
    sz = 8.0
    while sz >= 5.4:
        sw, qw, ow = width(sku, sz), width(qty, sz), width(ov, sz)
        if sw + gap + qw <= maxw + 0.4 and ow <= maxw + 0.4:
            return 2, sz, sw, qw, ow
        sz = round(sz - 0.1, 2)
    return 2, 5.4, width(sku, 5.4), width(qty, 5.4), width(ov, 5.4)


def render_pdf(labels):
    """PDF 51×19 mm. Nombre completo, código, cantidad, OV y Code128 del SKU."""
    width = round(WIDTH_MM / 25.4 * 72.0, 2)
    height = round(HEIGHT_MM / 25.4 * 72.0, 2)
    max_w = width - 2 * (1.5 / 25.4 * 72.0)
    contents = []
    for lab in labels:
        fields = lab["fields"]
        nombre = str(fields.get("nombre", ""))
        size = 11.0
        lines = wrap_words(nombre, size, max_w)
        while size > 4.6 and len(lines) * (size * 1.16) > 12.0 / 25.4 * 72.0:
            size = round(size - 0.2, 2)
            lines = wrap_words(nombre, size, max_w)
        parts = ["BT"]
        y = height - (1.3 / 25.4 * 72.0) - size * 0.8
        step = size * 1.16
        for line in lines:
            raw = line.encode("latin-1", "replace").decode("latin-1")
            parts.append("/F2 %.2f Tf" % size)
            parts.append("1 0 0 1 %.2f %.2f Tm (%s) Tj" % (1.5 / 25.4 * 72.0, y, pdf_escape(raw)))
            y -= step
        sku = str(fields.get("sku", "")).encode("latin-1", "replace").decode("latin-1")
        qty = (u"\u00d7" + str(fields.get("qty", ""))).encode("latin-1", "replace").decode("latin-1")
        ov = str(fields.get("ov", "")).encode("latin-1", "replace").decode("latin-1")
        rows, pt, sw, qw, ow = place_ids(sku, qty, ov)
        x0 = 1.5 / 25.4 * 72.0
        gap = 1.15 / 25.4 * 72.0
        bar_top = (1.0 + 6.2) / 25.4 * 72.0
        if rows == 1:
            y_sku = bar_top + 3
            y_ov = y_sku
            x_ov = width - (1.5 / 25.4 * 72.0) - ow
        else:
            y_ov = bar_top + 2
            y_sku = y_ov + pt * 1.25
            x_ov = x0
        parts.append("/F2 %.2f Tf" % pt)
        parts.append("1 0 0 1 %.2f %.2f Tm (%s) Tj" % (x0, y_sku, pdf_escape(sku)))
        parts.append("/F2 %.2f Tf" % pt)
        parts.append("1 0 0 1 %.2f %.2f Tm (%s) Tj" % (x0 + sw + gap, y_sku, pdf_escape(qty)))
        parts.append("/F2 %.2f Tf" % pt)
        parts.append("1 0 0 1 %.2f %.2f Tm (%s) Tj" % (x_ov, y_ov, pdf_escape(ov)))
        parts.append("ET")
        parts.extend(code128_bars(str(fields.get("sku", "")), width, height))
        contents.append("\n".join(parts).encode("latin-1", "replace"))

    objects = []

    def add(blob):
        objects.append(blob)
        return len(objects)

    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    bold_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    page_ids = []
    content_ids = []
    for blob in contents:
        content_ids.append(add(b"<< /Length %d >>\nstream\n" % len(blob) + blob + b"\nendstream"))
    for cid in content_ids:
        page = (
            "<< /Type /Page /Parent 0 0 R /MediaBox [0 0 %.2f %.2f] "
            "/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>"
            % (width, height, font_id, bold_id, cid)
        ).encode("ascii")
        page_ids.append(add(page))
    kids = " ".join("%d 0 R" % i for i in page_ids)
    pages_id = add(("<< /Type /Pages /Count %d /Kids [%s] >>" % (len(page_ids), kids)).encode("ascii"))
    # Parent references were 0 0 R; patch them now that the pages object exists.
    fixed = []
    for obj in objects:
        if obj.startswith(b"<< /Type /Page "):
            obj = obj.replace(b"/Parent 0 0 R", ("/Parent %d 0 R" % pages_id).encode("ascii"), 1)
        fixed.append(obj)
    objects = fixed
    catalog_id = add(("<< /Type /Catalog /Pages %d 0 R >>" % pages_id).encode("ascii"))

    out = [b"%PDF-1.4\n"]
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(sum(len(x) for x in out))
        out.append(("%d 0 obj\n" % i).encode("ascii"))
        out.append(obj)
        out.append(b"\nendobj\n")
    xref_at = sum(len(x) for x in out)
    xref = ["xref\n0 %d\n" % (len(objects) + 1), "0000000000 65535 f \n"]
    for off in offsets[1:]:
        xref.append("%010d 00000 n \n" % off)
    out.append("".join(xref).encode("ascii"))
    out.append(
        ("trailer << /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, catalog_id, xref_at)).encode("ascii")
    )
    return b"".join(out)


def job_ok(job):
    if not isinstance(job, dict):
        return False
    for key in FORBIDDEN:
        if key in job:
            return False
    labels = job.get("labels") or []
    if not labels:
        return False
    for lab in labels:
        if not isinstance(lab, dict):
            return False
        if lab.get("profile") != PROFILE or lab.get("paper") != PAPER:
            return False
        try:
            width = float(lab.get("width_mm"))
            height = float(lab.get("height_mm"))
        except (TypeError, ValueError):
            return False
        if abs(width - WIDTH_MM) > 0.2 or abs(height - HEIGHT_MM) > 0.2:
            return False
        fields = lab.get("fields") or {}
        for name in FIELDS:
            if name not in fields:
                return False
        for key in FORBIDDEN:
            if key in lab or key in fields:
                return False
    return True


def cups_online(queue, run):
    code, out, err = run(["lpstat", "-p", queue], 15)
    text = ((out or "") + "\n" + (err or "")).lower()
    if code != 0:
        return False
    if "disabled" in text or "offline" in text or "not available" in text:
        return False
    return ("idle" in text) or ("printing" in text) or ("enabled" in text)


def parse_cups_id(text):
    match = CUPS_ID_RX.search(text or "")
    return match.group(1) if match else ""


def submit(queue, pdf_bytes, run):
    if not QUEUE_RX.match(queue or ""):
        return {"outcome": "send_error", "cups_job_id": None}
    fd, path = tempfile.mkstemp(prefix="mc-etiq-", suffix=".pdf")
    try:
        os.write(fd, pdf_bytes)
        os.close(fd)
        fd = None
        argv = ["lp", "-d", queue, "-t", "Minecore-clientes", "-o", "media=Custom.51x19mm", "-o", "fit-to-page", path]
        try:
            code, out, err = run(argv, 30)
        except Exception as exc:
            if exc.__class__.__name__ not in ("TimeoutExpired", "BridgeTimeout", "TimeoutError"):
                raise
            return {"outcome": "ambiguous", "cups_job_id": None}
        text = (out or "") + "\n" + (err or "")
        cups = parse_cups_id(text)
        if code == 0 and cups:
            return {"outcome": "accepted", "cups_job_id": cups}
        if cups or code == 0:
            return {"outcome": "ambiguous", "cups_job_id": cups or None}
        return {"outcome": "send_error", "cups_job_id": None}
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


def step(transport, queue, run):
    """Una vuelta. Como máximo un lp. Un resultado ambiguo no dispara otro lp."""
    online = cups_online(queue, run)
    transport("heartbeat", {"printer_online": bool(online)})
    if not online:
        return {"did": "printer_offline", "submitted": False, "lp": 0}
    claimed = transport("claim", {}) or {}
    job = claimed.get("job")
    if not job:
        return {"did": claimed.get("held") or "idle", "submitted": False, "lp": 0}
    if not job_ok(job):
        transport("report", {
            "job_id": job.get("id"),
            "attempt_id": claimed.get("attempt_id"),
            "outcome": "send_error",
            "cups_job_id": "",
        })
        return {"did": "rejected", "submitted": False, "lp": 0}
    result = submit(queue, render_pdf(job["labels"]), run)
    transport("report", {
        "job_id": job.get("id"),
        "attempt_id": claimed.get("attempt_id"),
        "outcome": result["outcome"],
        "cups_job_id": result.get("cups_job_id") or "",
    })
    return {
        "did": result["outcome"],
        "submitted": result["outcome"] == "accepted",
        "cups_job_id": result.get("cups_job_id"),
        "lp": 1,
        "physically_printed": False,
    }


def _text(blob):
    if blob is None:
        return ""
    if isinstance(blob, bytes):
        return blob.decode("utf-8", "replace")
    return blob


def default_run(argv, timeout):
    if not isinstance(argv, list) or not argv:
        raise ValueError("argv")
    if argv[0] not in ("lp", "lpstat"):
        raise ValueError("comando")
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
        raise BridgeTimeout("lp")
    return proc.returncode, _text(out), _text(err)


def post(cfg, op, body):
    payload = dict(body or {})
    payload["op"] = "etiq_" + op
    data = json.dumps(payload).encode("utf-8")
    req = Request(cfg["api_base"], data=data)
    req.add_header("Content-Type", "application/json")
    req.add_header("x-etiq-bridge", cfg["token"])
    res = urlopen(req, timeout=25, context=ssl.create_default_context())
    try:
        raw = _text(res.read())
    finally:
        res.close()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict) or parsed.get("etiq") != 1 or parsed.get("physically_printed") is not False:
        raise RuntimeError("respuesta no reconocida")
    return parsed


def main(argv):
    if len(argv) > 1:
        raise SystemExit("sin argumentos: el token se lee del archivo, no de la línea de comandos")
    path = os.path.expanduser("~/.minecore-dymo/bridge.conf")
    cfg = load_config(path)

    def transport(op, body):
        return post(cfg, op, body)

    while True:
        try:
            step(transport, cfg["queue"], default_run)
        except Exception as exc:
            sys_msg = exc.__class__.__name__
            sys.stdout.write("puente: %s\n" % sys_msg)
            try:
                sys.stdout.flush()
            except Exception:
                pass
        time.sleep(20)


if __name__ == "__main__":
    main(sys.argv)
