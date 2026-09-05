#!/usr/bin/env bash
# Flash main.py onto the micro:bit. Does NOT also flash shaping.py — uflash
# only ever flashes a single script; see BRINGUP.md if main.py needs it too.
# Requires: python3 -m pip install uflash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m uflash main.py
echo "Flashed. shaping.py must be copied separately if uflash did not bundle it;"
echo "if you see ImportError on the display, inline shaping.py into main.py."
