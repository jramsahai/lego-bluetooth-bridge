#!/usr/bin/env bash
# Flash the micro:bit. uflash only ever flashes a single script, and
# main.py's `uart.init(tx=pin0, rx=pin1)` reroutes the micro:bit's only
# UART away from USB almost immediately after boot, which rules out
# `microfs put`-ing shaping.py onto the device as a second file (its REPL
# access is gone by the time you'd run it). So build_bundle.py inlines
# shaping.py into main.py first; see its docstring for the full reasoning.
# shaping.py stays the source of truth and stays under test
# (test_shaping.py) — only the generated bundle, never a hand-maintained
# copy, gets flashed.
#
# Requires uflash: python3 -m pip install uflash (or, on a system with a
# PEP 668 externally-managed Python, a local venv: python3 -m venv .venv &&
# .venv/bin/pip install uflash — this script prefers ./.venv if present).
set -euo pipefail
cd "$(dirname "$0")"

PY=python3
if [ -x .venv/bin/python ]; then
    PY=.venv/bin/python
fi

# uflash requires a ".py" source filename; mktemp's trailing-X substitution
# doesn't support a literal suffix after the Xs, so make a temp dir instead
# and give the file a fixed name inside it.
BUNDLE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/microbit_bundle.XXXXXX")"
trap 'rm -rf "$BUNDLE_DIR"' EXIT
BUNDLE="$BUNDLE_DIR/bundle.py"

"$PY" build_bundle.py > "$BUNDLE"
"$PY" -m uflash "$BUNDLE"
echo "Flashed shaping.py + main.py as one bundle."
