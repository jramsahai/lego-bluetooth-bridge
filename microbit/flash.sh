#!/usr/bin/env bash
# Flash main.py plus its shaping module onto the micro:bit.
# Requires: python3 -m pip install uflash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m uflash main.py
echo "Flashed. shaping.py must be copied separately if uflash did not bundle it;"
echo "if you see ImportError on the display, inline shaping.py into main.py."
