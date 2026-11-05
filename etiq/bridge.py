# -*- coding: utf-8 -*-
"""Puente saliente a ventas-api y a la DYMO Wireless (perfil Clientes).

Corre en Python 2.7.16 (el de Catalina) o en un Python 3 real.
No abre puertos, no imprime el token y no habla con portal-api.
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
    "validated_on": "Linux CPython 2.7.18 y 3.12, CUPS simulado. No corrido en el iMac.",
    "api": "https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api",
    "notes": "No usa /usr/bin/python3 de Catalina: ese archivo abre el cuadro de Command Line Tools. No instala Homebrew ni esas herramientas. TLS se verifica; no se apaga. Pantalla bloqueada no detiene un LaunchAgent de la sesión. Reposo del sistema, apagado o cerrar sesión sí lo detienen.",
}
CA_FILES = (
    "/etc/ssl/cert.pem",
    "/private/etc/ssl/cert.pem",
    "/etc/ssl/certs/ca-certificates.crt",
)

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


def u_text(value):
    """Texto unicode en Python 2 y 3. No pasa por el encoding ascii del sistema."""
    if value is None:
        return u""
    if type(value) is type(u""):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return u"%s" % value


def as_bytes(value):
    if isinstance(value, bytes) and type(value) is not type(u""):
        return value
    return u_text(value).encode("utf-8")


def pdf_escape(text):
    blob = u_text(text).encode("latin-1", "replace")
    return blob.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


# Helvetica-Bold, milésimas de em, caracteres 32..126. CapHeight 729.
# El signo × (U+00D7) mide 584.
_HB = (
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
)
_CAP = 0.729
_LEAD = 1.05
# El JSON del trabajo sigue en 51×19. El papel medido es 30 mm de ancho
# por 50 mm de avance, partido a lo largo en 20 mm y 10 mm.
PAGE_W_MM = 30.0
PAGE_H_MM = 51.0
LOGIC_W_MM = 51.0
LOGIC_H_MM = 30.0
SEAM_MM = 10.0
DRAW = "v5-dos-stickers"


def _mm(v):
    return float(v) / 25.4 * 72.0


def hb_units(ch):
    o = ord(ch)
    if o == 0xD7:
        return 584
    if 32 <= o <= 126:
        return _HB[o - 32]
    return 722


def hb_width(text, pt):
    total = 0
    for ch in u_text(text):
        total += hb_units(ch)
    return total * float(pt) / 1000.0


def wrap_words(text, size_pt, max_w_pt):
    """Parte por palabras. None si una palabra no cabe a este cuerpo."""
    words = u_text(text).split()
    if not words:
        return [u""]
    lines = []
    cur = u""
    for word in words:
        if hb_width(word, size_pt) > max_w_pt + 0.2:
            return None
        trial = word if not cur else cur + u" " + word
        if hb_width(trial, size_pt) <= max_w_pt + 0.2:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _split_token(word, size_pt, max_w_pt):
    out = []
    cur = u""
    for ch in u_text(word):
        trial = cur + ch
        if cur and hb_width(trial, size_pt) > max_w_pt + 0.2:
            out.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        out.append(cur)
    return out or [u""]


def fit_name(text, max_w, max_h):
    size = 8.6
    while size >= 2.8:
        lines = wrap_words(text, size, max_w)
        if lines is not None:
            block = (len(lines) - 1) * size * _LEAD + size * _CAP
            if block <= max_h + 0.15:
                return size, lines, block
        size = round(size - 0.1, 2)
    size = 2.8
    words = u_text(text).split() or [u""]
    lines = []
    cur = u""
    for word in words:
        parts = [word] if hb_width(word, size) <= max_w + 0.2 else _split_token(word, size, max_w)
        for part in parts:
            trial = part if not cur else cur + u" " + part
            if cur and hb_width(trial, size) > max_w + 0.2:
                lines.append(cur)
                cur = part
            else:
                cur = trial
    if cur:
        lines.append(cur)
    if not lines:
        lines = [u""]
    block = (len(lines) - 1) * size * _LEAD + size * _CAP
    return size, lines, block


_PAT = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split()


def code128_codes(text):
    text = u_text(text).encode("ascii", "replace").decode("ascii")
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


def code128_bars(sku, page_w, y_pt, bar_h):
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
    total = (mods + quiet * 2) * module
    x = (page_w - total) / 2.0 + quiet * module
    y = y_pt
    rects = []
    for p in pats:
        black = True
        for ch in p:
            ww = int(ch) * module
            if black and ww > 0:
                rects.append((x, y, ww, bar_h))
            x += ww
            black = not black
    return rects


def place_ids(sku, qty, ov):
    """Una fila centrada. SKU, cantidad y OV al mismo tamaño, achicados juntos."""
    gap = _mm(1.15)
    sep = _mm(2.4) if ov else 0.0
    maxw = _mm(LOGIC_W_MM - 3.0)
    sz = 8.2
    while sz >= 3.2:
        sw, qw = hb_width(sku, sz), hb_width(qty, sz)
        ow = hb_width(ov, sz) if ov else 0.0
        if sw + gap + qw + sep + ow <= maxw + 0.3:
            return 1, sz, sw, qw, ow
        sz = round(sz - 0.1, 2)
    sz = 3.2
    ow = hb_width(ov, sz) if ov else 0.0
    return 1, sz, hb_width(sku, sz), hb_width(qty, sz), ow


def layout_label(fields, page_w=None, page_h=None):
    """Plano de 50×30 mm. Abajo, 10 mm solo para el código. Arriba, 20 mm para el texto.
    page_w y page_h se ignoran: el papel medido sustituye al 51×19."""
    nombre = u_text(fields.get("nombre", ""))
    sku = u_text(fields.get("sku", ""))
    qty = u"\u00d7" + u_text(fields.get("qty", ""))
    ov = u_text(fields.get("ov", ""))
    logic_w = _mm(LOGIC_W_MM)
    max_w = logic_w - 2 * _mm(1.5)
    bar_y = _mm(1.3)
    bar_h = _mm(6.2)
    rows, pt, sw, qw, ow = place_ids(sku, qty, ov)
    gap = _mm(1.15)
    sep = _mm(2.4) if ov else 0.0
    row = sw + gap + qw + (sep + ow if ov else 0.0)
    x0 = (logic_w - row) / 2.0
    base = _mm(SEAM_MM + 1.6)
    code_top = base + pt * _CAP
    name_top = _mm(LOGIC_H_MM - 0.7)
    name_h = name_top - (code_top + _mm(0.45))
    size, lines, block = fit_name(nombre, max_w, name_h)
    slack = name_h - block
    if slack < 0:
        slack = 0
    first_top = name_top - slack / 2.0
    y_name = first_top - size * _CAP
    lead = size * _LEAD
    names = []
    y = y_name
    for line in lines:
        w = hb_width(line, size)
        names.append(((logic_w - w) / 2.0, y, w, size * _CAP, line))
        y -= lead
    return {
        "sku": sku, "qty": qty, "ov": ov, "pt": pt, "size": size, "lines": lines,
        "names": names, "x0": x0, "sw": sw, "qw": qw, "ow": ow, "gap": gap, "sep": sep,
        "base": base, "code_top": code_top, "bar_y": bar_y, "bar_h": bar_h,
        "name_top": name_top, "logic_w": logic_w, "seam": _mm(SEAM_MM),
    }


def _emit_feed_text(parts, text, size, lx, ly):
    """El texto empieza por el borde que sale primero y sigue hacia la impresora. El nombre queda a la derecha."""
    parts.append(b"/F2 %.2f Tf" % size)
    parts.append(b"0 -1 1 0 %.2f %.2f Tm (" % (ly, _mm(PAGE_H_MM) - lx) + pdf_escape(text) + b") Tj")


def render_pdf(labels):
    """Página 30×51 mm. El texto va a lo largo del avance. Sin marcas de corte."""
    width = round(_mm(PAGE_W_MM), 2)
    height = round(_mm(PAGE_H_MM), 2)
    contents = []
    for lab in labels:
        lay = layout_label(lab["fields"])
        parts = [b"BT"]
        for x_name, y, w_name, h_name, line in lay["names"]:
            _emit_feed_text(parts, line, lay["size"], x_name, y)
        x_qty = lay["x0"] + lay["sw"] + lay["gap"]
        x_ov = x_qty + lay["qw"] + lay["sep"]
        _emit_feed_text(parts, lay["sku"], lay["pt"], lay["x0"], lay["base"])
        _emit_feed_text(parts, lay["qty"], lay["pt"], x_qty, lay["base"])
        if lay["ov"]:
            _emit_feed_text(parts, lay["ov"], lay["pt"], x_ov, lay["base"])
        parts.append(b"ET")
        for x, y, w, h in code128_bars(lay["sku"], lay["logic_w"], lay["bar_y"], lay["bar_h"]):
            parts.append(("%.2f %.2f %.2f %.2f re f" % (y, _mm(PAGE_H_MM) - (x + w), h, w)).encode("ascii"))
        contents.append(b"\n".join(parts))

    objects = []

    def add(blob):
        objects.append(blob)
        return len(objects)

    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    bold_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
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
    """La cola existe y no está parada ni sin enlace. No certifica papel ni el aparato."""
    code, out, err = run(["lpstat", "-p", "-l", queue], 15)
    text = ((out or "") + "\n" + (err or "")).lower()
    if code != 0:
        return False
    for word in (
        "disabled", "offline", "not available", "paused",
        "unable to connect", "cannot connect", "connecting-to-device",
        "offline-report", "unreachable",
    ):
        if word in text:
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
        argv = ["lp", "-d", queue, "-t", "Minecore-clientes", "-o", "media=Custom.30x51mm", path]
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


def https_context():
    """Verifica el certificado. No baja verify_mode ni check_hostname."""
    ctx = ssl.create_default_context()
    for path in CA_FILES:
        if os.path.isfile(path):
            ctx.load_verify_locations(path)
            break
    if ctx.verify_mode != ssl.CERT_REQUIRED or not ctx.check_hostname:
        raise RuntimeError("tls")
    return ctx


def _open(req):
    return urlopen(req, timeout=25, context=https_context())


def post(cfg, op, body):
    payload = dict(body or {})
    payload["op"] = "etiq_" + op
    data = json.dumps(payload).encode("utf-8")
    req = Request(cfg["api_base"], data=data)
    req.add_header("Content-Type", "application/json")
    req.add_header("x-etiq-bridge", cfg["token"])
    res = _open(req)
    try:
        raw = _text(res.read())
    finally:
        res.close()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict) or parsed.get("etiq") != 1 or parsed.get("physically_printed") is not False:
        raise RuntimeError("respuesta no reconocida")
    return parsed


def write_secret_file(path, text):
    blob = as_bytes(text)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        os.write(fd, blob)
    finally:
        os.close(fd)
    os.chmod(path, 0o600)
    if os.stat(path).st_mode & 0o077:
        raise RuntimeError("permisos")


def vincular(path, conf_path=None, opener=None):
    """Canjea el código de un solo uso. El token queda en bridge.conf y no se imprime."""
    if os.stat(path).st_mode & 0o077:
        raise ValueError("archivo del codigo")
    try:
        with io.open(path, "r", encoding="utf-8") as handle:
            spec = json.load(handle)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if not isinstance(spec, dict):
        raise ValueError("archivo del codigo")
    code = u_text(spec.get("code")).strip().upper()
    queue = u_text(spec.get("queue")).strip()
    if not code or not QUEUE_RX.match(queue) or "450" in queue:
        raise ValueError("codigo o cola")
    url = "https://%s/functions/v1/ventas-api" % ALLOWED_HOSTS[0]
    data = json.dumps({"op": "etiq_pair_finish", "code": code}).encode("utf-8")
    req = Request(url, data=data)
    req.add_header("Content-Type", "application/json")
    req.add_header("x-etiq-pair", "1")
    res = (opener or _open)(req)
    try:
        raw = _text(res.read())
    finally:
        closer = getattr(res, "close", None)
        if closer:
            closer()
    parsed = json.loads(raw)
    token = parsed.get("token") if isinstance(parsed, dict) else None
    token_s = u_text(token).strip()
    if (not isinstance(parsed, dict) or not parsed.get("ok") or not token_s
            or parsed.get("physically_printed") is not False or len(token_s) < 16):
        raise RuntimeError("codigo no sirvio")
    if u"\n" in token_s or u"\r" in token_s or u" " in token_s:
        raise RuntimeError("codigo no sirvio")
    dest = conf_path or os.path.expanduser("~/.minecore-dymo/bridge.conf")
    parent = os.path.dirname(dest)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    if parent:
        os.chmod(parent, 0o700)
    conf = u"BRIDGE_TOKEN=%s\nCUPS_QUEUE=%s\nAPI_BASE=%s\n" % (token_s, queue, url)
    write_secret_file(dest, conf)


def main(argv):
    if len(argv) == 3 and argv[1] == "--vincular":
        try:
            vincular(argv[2])
        except Exception as exc:
            sys.stdout.write("no-vinculado %s\n" % exc.__class__.__name__)
            return 2
        sys.stdout.write("vinculado\n")
        return 0
    if len(argv) > 1:
        raise SystemExit("sin argumentos: el token se lee del archivo, no de la linea de comandos")
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
        time.sleep(3)


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
