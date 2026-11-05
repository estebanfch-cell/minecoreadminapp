# Elegir un Python real en Catalina. No ejecuta /usr/bin/python3:
# ese archivo abre el cuadro de Command Line Tools aunque se le pase -c.
# Bash 3.2 (el de Catalina). No uses command -v: encuentra el stub primero.

minecore_is_clt_stub() {
  _p=$1
  if [ -z "${_p}" ] || [ ! -f "${_p}" ] || [ ! -x "${_p}" ]; then
    return 0
  fi
  _usr3=${MINECORE_USR_PYTHON3:-/usr/bin/python3}
  if [ "${_p}" = "${_usr3}" ]; then
    return 0
  fi
  if grep -a -q -F 'libxcselect' "${_p}" 2>/dev/null; then
    return 0
  fi
  if grep -a -q -F 'xcode-select' "${_p}" 2>/dev/null; then
    return 0
  fi
  return 1
}

minecore_python_ok() {
  "$1" -c 'import sys,json,ssl,io
v=sys.version_info
ok=(v[0]==2 and v[1]>=7) or v[0]>=3
ctx=ssl.create_default_context()
if ctx.verify_mode!=ssl.CERT_REQUIRED or not ctx.check_hostname:
    ok=False
raise SystemExit(0 if ok else 1)'
}

minecore_python_mm() {
  "$1" -c 'import sys; sys.stdout.write("%d.%d" % (sys.version_info[0], sys.version_info[1]))'
}

minecore_python_candidates() {
  if [ -n "${MINECORE_PY_LIST:-}" ]; then
    printf '%s\n' "${MINECORE_PY_LIST}" | tr ':' '\n'
    return 0
  fi
  _old=$(shopt -p nullglob || true)
  shopt -s nullglob
  _v=""
  for _v in 3.13 3.12 3.11 3.10 3.9 3.8 3.7 3.6; do
    _p="/Library/Frameworks/Python.framework/Versions/${_v}/bin/python3"
    if [ -x "${_p}" ]; then
      printf '%s\n' "${_p}"
    fi
  done
  _p="/Library/Frameworks/Python.framework/Versions/Current/bin/python3"
  if [ -x "${_p}" ]; then
    printf '%s\n' "${_p}"
  fi
  for _p in /usr/local/bin/python3 /opt/local/bin/python3 /usr/bin/python2.7 /usr/bin/python; do
    if [ -x "${_p}" ]; then
      printf '%s\n' "${_p}"
    fi
  done
  eval "${_old}"
}

minecore_pick_python() {
  _best=""
  _bestmm=""
  _p=""
  _mm=""
  while IFS= read -r _p; do
    if [ -z "${_p}" ]; then
      continue
    fi
    if minecore_is_clt_stub "${_p}"; then
      continue
    fi
    if ! minecore_python_ok "${_p}"; then
      continue
    fi
    _mm=$(minecore_python_mm "${_p}" || true)
    case "${_mm}" in
      3.*)
        case "${_bestmm}" in
          3.*) ;;
          *) _best=${_p}; _bestmm=${_mm} ;;
        esac
        ;;
      2.7)
        if [ -z "${_best}" ]; then
          _best=${_p}
          _bestmm=${_mm}
        fi
        ;;
    esac
  done <<EOF
$(minecore_python_candidates)
EOF
  printf '%s\n' "${_best}"
}
