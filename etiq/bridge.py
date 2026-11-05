# -*- coding: utf-8 -*-
"""Puente saliente hacia la DYMO LabelWriter Wireless (perfil Clientes).

Declarado para macOS 10.15 Catalina con Python 3.8+ (la biblioteca estándar)
y CUPS (lp / lpstat). Este archivo no se validó en un Mac: las pruebas corren
en Linux con CUPS simulado. No abre puertos, no imprime solo y no trae token.
"""

from __future__ import print_function

import json
import os
import re
import ssl
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

COMPAT = {
    "declared": "Python 3.8+ biblioteca estándar, CUPS lp/lpstat, HTTPS saliente",
    "os_target": "macOS 10.15 Catalina",
    "validated_on_target": False,
    "validated_on": "Linux CPython, CUPS simulado",
    "notes": "Catalina no incluye Python 3. Hace falta Python 3.8 de python.org, sin actualizar el sistema.",
}

PROFILE = "clientes"
WIDTH_MM = 51.0
HEIGHT_MM = 19.0
PAPER = "30330"
FIELDS = ("nombre", "cod_prov", "categoria", "sku", "linea")
ALLOWED_HOSTS = ("bklbvwpkrdaojbezljsd.supabase.co",)
FORBIDDEN = ("url", "cmd", "shell", "cups_queue", "lp", "argv", "printer", "destination")
QUEUE_RX = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
CUPS_ID_RX = re.compile(r"request id is\s+([A-Za-z0-9_-]+)", re.I)


def resolve_base(url):
    parts = urllib.parse.urlsplit(url or "")
    host = parts.hostname or ""
    if parts.scheme != "https" or host not in ALLOWED_HOSTS:
        raise ValueError("host no permitido")
    if parts.username or parts.password:
        raise ValueError("credencial en la URL")
    path = parts.path or "/functions/v1/portal-api"
    return "https://" + host + path


def load_config(path):
    mode = os.stat(path).st_mode & 0o777
    if mode & 0o077:
        raise ValueError("el archivo de configuración debe ser chmod 600")
    data = {}
    with open(path, "r", encoding="utf-8") as handle:
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
    base = resolve_base(data.get("API_BASE") or ("https://%s/functions/v1/portal-api" % ALLOWED_HOSTS[0]))
    return {"token": token, "queue": queue, "api_base": base}


def pdf_escape(text):
    return str(text).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render_pdf(labels):
    """PDF mínimo 51×19 mm, un página por etiqueta, solo los campos del perfil Clientes."""
    width = round(WIDTH_MM / 25.4 * 72.0, 2)
    height = round(HEIGHT_MM / 25.4 * 72.0, 2)
    contents = []
    for lab in labels:
        fields = lab["fields"]
        lines = [str(fields.get(name, "")) for name in FIELDS]
        parts = ["BT /F1 6 Tf"]
        y = height - 8
        for line in lines:
            raw = line.encode("latin-1", "replace").decode("latin-1")
            parts.append("1 0 0 1 4 %.2f Tm (%s) Tj" % (y, pdf_escape(raw)))
            y -= 8
        parts.append("ET")
        contents.append("\n".join(parts).encode("latin-1", "replace"))

    objects = []

    def add(blob):
        objects.append(blob)
        return len(objects)

    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids = []
    content_ids = []
    for blob in contents:
        content_ids.append(add(b"<< /Length %d >>\nstream\n" % len(blob) + blob + b"\nendstream"))
    for cid in content_ids:
        page = (
            "<< /Type /Page /Parent 0 0 R /MediaBox [0 0 %.2f %.2f] "
            "/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (width, height, font_id, cid)
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
        except subprocess.TimeoutExpired:
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


def default_run(argv, timeout):
    if not isinstance(argv, list) or not argv or any(not isinstance(item, str) for item in argv):
        raise ValueError("argv")
    if argv[0] not in ("lp", "lpstat"):
        raise ValueError("comando")
    proc = subprocess.run(argv, timeout=timeout, capture_output=True, universal_newlines=True, shell=False)
    return proc.returncode, proc.stdout, proc.stderr


def post(cfg, op, body):
    payload = json.dumps({"action": "etiq_bridge", "op": op, "body": body}).encode("utf-8")
    req = urllib.request.Request(cfg["api_base"], data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + cfg["token"])
    with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context()) as res:
        raw = res.read().decode("utf-8")
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
            print("puente: %s" % sys_msg, flush=True)
        time.sleep(20)


if __name__ == "__main__":
    import sys
    main(sys.argv)
