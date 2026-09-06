#!/usr/bin/env python3
"""Inline shaping.py into main.py for uflash.

uflash only ever flashes a single script (see flash.sh), and main.py's
`uart.init(tx=pin0, rx=pin1)` reroutes the micro:bit's only UART away from
USB the instant it runs — which kills `microfs`'s REPL access almost
immediately after boot, so putting shaping.py onto the device filesystem as
a second file (docs/BRINGUP.md's other suggested fix) does not work with
this script. Concatenating shaping.py's actual source into a bundle and
flashing that as one file sidesteps both problems.

shaping.py remains the source of truth and stays under test
(test_shaping.py); this script never edits it, only reads it, so the bundle
can't drift out of sync with a source change silently — if main.py's import
line ever changes shape, this errors instead of producing a stale bundle.

Usage: build_bundle.py > bundled.py
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
IMPORT_RE = re.compile(r"^from shaping import .*$", re.MULTILINE)


def build_bundle():
    shaping_src = (HERE / "shaping.py").read_text()
    main_src = (HERE / "main.py").read_text()

    matches = IMPORT_RE.findall(main_src)
    if len(matches) != 1:
        sys.exit(
            "build_bundle.py: expected exactly one 'from shaping import ...' "
            f"line in main.py, found {len(matches)}. main.py's import "
            "changed shape; update this script's IMPORT_RE to match."
        )

    banner_top = (
        "# GENERATED BUNDLE — do not edit by hand, do not commit.\n"
        "# Built by build_bundle.py, which inlines shaping.py in place of\n"
        "# main.py's `from shaping import ...` line (see that script's\n"
        "# docstring for why). shaping.py remains the source of truth and\n"
        "# stays under test (test_shaping.py).\n"
        "\n"
        "# ---- begin shaping.py ----\n"
    )
    banner_bottom = "# ---- end shaping.py ----"

    replacement = banner_top + shaping_src.rstrip("\n") + "\n" + banner_bottom
    # A function replacement, not a string one: re.sub interprets backslash
    # escapes (\n, \1, \g<name>, ...) in a *string* replacement, which would
    # mangle shaping.py's own "\n" string literal into a real newline and
    # break the bundle's syntax. A callable's return value is used verbatim.
    bundle = IMPORT_RE.sub(lambda _m: replacement, main_src, count=1)
    return bundle


if __name__ == "__main__":
    sys.stdout.write(build_bundle())
