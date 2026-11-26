#!/usr/bin/env python3
"""Prueba de humo del login del portal (Chromium + WebKit).
Carga la URL, exige que no haya SyntaxError en consola, que el PIN registre
pulsaciones y que «Ingresar» dispare la petición a portal-api (login).
La red de login se intercepta: nunca se envía un PIN real (ni uno de prueba) al servidor.
Uso: tools/smoke-login.py --url URL [--out DIR] [--browsers chromium,webkit]
Salida 0 si pasa; 1 si falla.
"""
from __future__ import annotations

import argparse, json, sys, time
from pathlib import Path

from playwright.sync_api import sync_playwright

LOGIN_URL_PART = "functions/v1/portal-api"
FAKE_USER = "SMOKE"
FAKE_PIN = "0000"  # nunca es el PIN de un usuario real; no se envía a la red


def launch(p, name: str):
    args = ["--no-sandbox", "--disable-dev-shm-usage"]
    if name == "chromium":
        try:
            return p.chromium.launch(executable_path="/usr/bin/google-chrome", args=args + ["--headless=new"])
        except Exception:
            return p.chromium.launch(args=args)
    if name == "webkit":
        return p.webkit.launch()
    if name == "firefox":
        return p.firefox.launch()
    raise SystemExit("navegador desconocido: " + name)


def smoke(browser_name: str, url: str, out: Path, width: int) -> dict:
    result = {
        "browser": browser_name,
        "width": width,
        "ok": False,
        "build": None,
        "syntax_errors": [],
        "console_errors": [],
        "pin_registered": False,
        "login_request": False,
        "login_action": None,
        "error": None,
        "shot": None,
    }
    with sync_playwright() as p:
        browser = launch(p, browser_name)
        page = browser.new_page(viewport={"width": width, "height": 844 if width <= 430 else 900})
        console = []
        page.on("console", lambda msg: console.append({"type": msg.type, "text": msg.text}))
        def _on_pageerror(exc):
            t=str(exc)
            if "SyntaxError" in t or "Unexpected token" in t:
                result["syntax_errors"].append(t)
            else:
                result["console_errors"].append("pageerror: "+t[:240])
        page.on("pageerror", _on_pageerror)

        login_hits = []

        # Intercepta fetch en la página (evita CORS de WebKit + route.fulfill y
        # evita que un fallo de signup_cfg ponga MC_SB_DOWN y bloquee el login).
        # El PIN nunca sale del navegador de prueba.
        page.add_init_script("""
(() => {
  window.__smokeHits = [];
  const orig = window.fetch;
  window.fetch = function(input, init) {
    const u = (typeof input === 'string') ? input : (input && input.url) || '';
    if (String(u).indexOf('functions/v1/portal-api') !== -1) {
      let action = null, has_user = false, has_pin = false;
      try {
        const body = init && init.body;
        const j = typeof body === 'string' ? JSON.parse(body) : {};
        action = j.action || j.op || null;
        has_user = !!j.user;
        has_pin = Object.prototype.hasOwnProperty.call(j, 'pin');
      } catch (e) {}
      window.__smokeHits.push({action, has_user, has_pin, via: 'fetch-hook'});
      return Promise.resolve(new Response(JSON.stringify({ok:false, error:'smoke-test'}), {
        status: 200,
        headers: {'Content-Type': 'application/json'}
      }));
    }
    return orig.apply(this, arguments);
  };
})();
""")

        def handle_route(route):
            req = route.request
            u = req.url or ""
            if LOGIN_URL_PART in u and req.method == "POST":
                body = req.post_data or ""
                action = None
                try:
                    j = json.loads(body)
                    action = j.get("action") or j.get("op")
                    # Nunca reenviar el PIN. Solo anotamos si vino action=login y un usuario.
                    login_hits.append({"action": action, "has_user": bool(j.get("user")), "has_pin": "pin" in j})
                except Exception:
                    login_hits.append({"action": "unparsed", "has_user": False, "has_pin": False})
                headers={
                    "access-control-allow-origin": "*",
                    "access-control-allow-methods": "POST, OPTIONS, GET",
                    "access-control-allow-headers": "content-type, authorization, apikey, x-client-info",
                    "content-type": "application/json",
                }
                if req.method == "OPTIONS":
                    route.fulfill(status=204, headers=headers, body="")
                    return
                route.fulfill(status=200, headers=headers, body=json.dumps({"ok": False, "error": "smoke-test"}))
                return
            if LOGIN_URL_PART in u and req.method == "OPTIONS":
                route.fulfill(status=204, headers={
                    "access-control-allow-origin": "*",
                    "access-control-allow-methods": "POST, OPTIONS, GET",
                    "access-control-allow-headers": "content-type, authorization, apikey, x-client-info",
                }, body="")
                return
            route.continue_()

        page.route("**/*", handle_route)
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(800)

        # Build: #mc-login-build or MC_BUILD
        build = page.evaluate(
            """() => {
              var el = document.getElementById('mc-login-build');
              var t = (el && el.textContent) || '';
              var m = t.match(/v?(\\d{3,})/);
              if (m) return m[1];
              try { return String(window.MC_BUILD || ''); } catch (e) { return ''; }
            }"""
        )
        result["build"] = build or None

        syn = [e for e in result["syntax_errors"] if "SyntaxError" in e or "Unexpected token" in e or "SyntaxError" in e]
        # also console
        for c in console:
            if c["type"] in ("error", "warning") or "SyntaxError" in c["text"] or "Unexpected token" in c["text"]:
                result["console_errors"].append("%s: %s" % (c["type"], c["text"][:240]))
                if "SyntaxError" in c["text"] or "Unexpected token" in c["text"]:
                    syn.append(c["text"])
        result["syntax_errors"] = syn

        # Login form present?
        usr = page.locator("#usr")
        pin = page.locator("#pin")
        btn = page.locator("button", has_text="Ingresar")
        if usr.count() == 0 or pin.count() == 0 or btn.count() == 0:
            result["error"] = "no está el formulario de login (#usr, #pin, Ingresar)"
        else:
            usr.fill(FAKE_USER)
            pin.fill("")
            pin.type(FAKE_PIN, delay=40)
            val = pin.input_value()
            result["pin_registered"] = val == FAKE_PIN
            if not result["pin_registered"]:
                result["error"] = "el PIN no registró las pulsaciones (valor=%r)" % val
            else:
                btn.scroll_into_view_if_needed()
                page.wait_for_timeout(200)
                btn.click(force=True)
                def _merge_hits_pre():
                    try:
                        extra = page.evaluate("() => window.__smokeHits || []") or []
                    except Exception:
                        extra = []
                    for h in extra:
                        if h not in login_hits:
                            login_hits.append(h)
                t0 = time.time()
                while time.time() - t0 < 6 and not any(h.get("action") == "login" for h in login_hits):
                    page.wait_for_timeout(100)
                    _merge_hits_pre()
                def _merge_hits():
                    try:
                        extra = page.evaluate("() => window.__smokeHits || []") or []
                    except Exception:
                        extra = []
                    for h in extra:
                        if h not in login_hits:
                            login_hits.append(h)
                _merge_hits()
                result["login_request"] = any(h.get("action") == "login" for h in login_hits)
                result["login_action"] = next((h.get("action") for h in login_hits if h.get("action")=="login"), (login_hits[-1]["action"] if login_hits else None))
                result["login_hits"] = login_hits
                if not result["login_request"]:
                    # fallback: call doLogin() directly if the click was occluded
                    page.evaluate("() => { try { doLogin(); } catch (e) {} }")
                    t0 = time.time()
                    while time.time() - t0 < 4:
                        _merge_hits()
                        if any(h.get("action") == "login" for h in login_hits):
                            break
                        page.wait_for_timeout(100)
                    _merge_hits()
                    result["login_request"] = any(h.get("action") == "login" for h in login_hits)
                    result["login_action"] = next((h.get("action") for h in login_hits if h.get("action")=="login"), None)
                    result["login_hits"] = login_hits
                if not result["login_request"]:
                    result["error"] = "Ingresar no disparó action=login hacia portal-api (hits=%s)" % login_hits

        shot = out / ("smoke-login-%s-%s.png" % (browser_name, width))
        page.screenshot(path=str(shot), full_page=True)
        result["shot"] = str(shot)
        result["ok"] = (
            not result["syntax_errors"]
            and result["pin_registered"]
            and result["login_request"]
            and result["error"] is None
        )
        browser.close()
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", default="/workspace/sol-cliente-claude/shots")
    ap.add_argument("--browsers", default="chromium,webkit")
    ap.add_argument("--widths", default="390,1280")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    browsers = [b.strip() for b in args.browsers.split(",") if b.strip()]
    widths = [int(w) for w in args.widths.split(",") if w.strip()]
    # First viewport per browser is enough for the assert; still shoot both widths on chromium.
    results = []
    failed = []
    for b in browsers:
        # full checks on the first width; extra screenshots optional
        r = smoke(b, args.url, out, widths[0])
        results.append(r)
        print(json.dumps(r, ensure_ascii=False))
        if not r["ok"]:
            failed.append("%s: %s %s" % (b, r.get("error"), r.get("syntax_errors")))
        for w in widths[1:]:
            r2 = smoke(b, args.url, out, w)
            results.append(r2)
            print(json.dumps(r2, ensure_ascii=False))
            if not r2["ok"]:
                failed.append("%s@%s: %s %s" % (b, w, r2.get("error"), r2.get("syntax_errors")))
    (out / "smoke-login.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    if failed:
        print("FAIL smoke-login: " + " | ".join(failed))
        sys.exit(1)
    print("OK smoke-login (%s)" % ", ".join(browsers))


if __name__ == "__main__":
    main()
