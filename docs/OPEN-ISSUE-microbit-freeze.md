# micro:bit freezes on the CONNECTED checkmark — RESOLVED

**Status (2026-09-06):** root cause identified by reading the micro:bit
MicroPython firmware source, and it explains every data point below,
including the two that looked contradictory. Fix applied on both sides
(ESP32 `statusToWire`, micro:bit `decode_status`) with unit tests.
**Confirmed on hardware the same day:** with both boards reflashed, the
display advances past the checkmark through the calibration clock to the
disarmed square, and tilt control drives the car. See "Resolution" at the
end for the cause and the evidence.

The historical narrative below is kept as-is (its "leading hypothesis" was
wrong; the analysis in "Resolution" supersedes it).


**This is the first time `microbit/main.py`'s hardware-facing logic (as
opposed to `shaping.py`'s pure math, which has real unit tests) has run wired
to a real ESP32.** Per `docs/BRINGUP.md`, that combination had never been
exercised before this session.

---

## The symptom

Wire the micro:bit to the ESP32 per the README's table (`P0`↔`GPIO16`/RX2,
`P1`↔`GPIO17`/TX2, `GND`↔`GND`, originally also `3V`↔`3V3`) and power it up.
The micro:bit's display reliably shows the correct sequence at first —
scanning diamond, then briefly the `CONNECTED` checkmark — and then **freezes
on the checkmark and never updates again**, regardless of what the ESP32
does afterward (calibrates successfully, becomes `READY_DISARMED`, etc.).
Once frozen, it stays frozen indefinitely; nothing observed (waiting,
tilting the board) unfreezes it. Only a fresh reboot/reflash of the micro:bit
clears it, temporarily.

## Firmware state right now

Both boards are back on clean, unmodified firmware — every temporary
diagnostic described below has been reverted (`git status` is clean on
`esp32/src/main.cpp` and `microbit/main.py`). The only uncommitted changes in
the repo are unrelated to this issue: a real, tested fix to
`microbit/flash.sh` (+ new `microbit/build_bundle.py`) for a separate,
already-resolved problem (see "Unrelated fix made along the way" below).

## Physical state right now

- ESP32: powered via the Mac's USB (for log visibility).
- micro:bit: powered via its own USB cable into the **second port of the
  same battery bank** intended for the ESP32 — i.e. independent power, not
  the ESP32's `3V3` pin.
- Wiring: only `P0`↔`GPIO16`, `P1`↔`GPIO17`, `GND`↔`GND`. **No `3V`
  connection** — deliberately removed as part of testing the brownout
  hypothesis (see below).
- Latest observed result in this exact configuration: **froze on the
  checkmark again.**

---

## Timeline of what was tried, in order

All of the following happened in a single session, on real hardware (LEGO
Technic 42160 / Hub 88012, one ESP32-WROOM dev board, one BBC micro:bit).

1. **ESP32 alone (no micro:bit) validated first**, using a temporary
   bench-test shim that routed hand-typed frames from `pio device monitor`
   (USB `Serial`) into the same parser that `Serial2` (the micro:bit UART)
   feeds. This confirmed, independently of the micro:bit: BLE connect,
   steering calibration (measured span/halfRange matched the Mac harness's
   independently-measured values three separate times), frame parsing,
   checksum validation, the arm/disarm latch (`FLAG_RECAL` required to arm,
   `FLAG_ARMED` alone only holds an existing arm), steering motor movement,
   and failsafe recovery (re-centers steering, brakes drive motors). The
   shim was fully reverted afterward (`git checkout`) — it must never coexist
   with a real micro:bit on `Serial2`, since both would feed one shared line
   buffer.

2. **Micro:bit flashed standalone first** (its own USB, not yet wired to the
   ESP32). Along the way, found and fixed a real, permanent bug: `uflash`
   only ever flashes one script, and `main.py`'s `uart.init(tx=pin0,
   rx=pin1)` reroutes the micro:bit's only UART away from USB almost
   immediately after boot — which *also* breaks `microfs put`'s ability to
   add `shaping.py` as a second file, since its REPL access is gone by the
   time you'd use it (the previously-documented fallback in an earlier
   version of `BRINGUP.md` does not actually work with this script). Fixed
   with a new `microbit/build_bundle.py` that inlines `shaping.py` into
   `main.py` at flash time (so `shaping.py` stays the single source of truth
   under test), and an updated `flash.sh` that uses it. Two further bugs
   were found and fixed while building that: BSD `mktemp` doesn't support a
   literal suffix after the `X`s (fixed with a temp directory + fixed
   filename), and `re.sub()` with a *string* replacement processes backslash
   escapes, which silently mangled `shaping.py`'s own `"\n"` string literal
   into a real newline and broke the generated bundle's syntax (fixed by
   using a callable replacement instead). Both `pio run -e esp32dev` and the
   `native`/`pytest` suites were re-verified green after these changes. This
   part is genuinely resolved and unrelated to the freeze below — see "What
   to keep" at the end.

3. **First wired test** (all four connections via alligator clips, through a
   breadboard the ESP32 sits in — the ESP32's pins are not directly
   reachable off the breadboard, so *every* connection, including `P0`/`P1`,
   goes ESP32 pin → breadboard hole → jumper wire → alligator clip →
   micro:bit pad). Micro:bit's display froze on the checkmark. This is the
   first occurrence of the core symptom this document is about.

4. **Added temporary ESP32-side instrumentation** (since reverted): a raw
   byte counter and a successfully-parsed-frame counter for `Serial2`, plus
   the current status, printed once a second. This distinguishes "wire is
   dead", "bytes arrive but don't parse", and "parsing fine, the micro:bit
   just isn't displaying it" — the existing single-shot failsafe log line
   can't tell these apart (it prints identically whether frames are flowing
   forever or never arrived at all).

5. **Data collected with that instrumentation** (all readings taken after
   letting the system run at least several seconds, to rule out "just
   hasn't gotten there yet"):

   | # | Wiring | rawBytes (Serial2) | goodFrames | status | Behavior |
   |---|--------|---------------------|------------|--------|----------|
   | A | All 4 via clips | 29 | 0 | 6 (FAILSAFE) | Froze immediately, never got even one full valid frame |
   | B | 3V/GND disconnected, micro:bit on own USB, P0/P1 still clipped | 252 | 21 | 6 | Froze after ~0.4s of real data |
   | C | *Same wiring as B*, but right after a fresh micro:bit reboot (reflash) | 22282→26242, climbing steadily | 2224→2620, climbing steadily | 4 (READY_DISARMED) | **Ran flawlessly** for the entire observed window (~9+ seconds), ~500 bytes/s and ~50 frames/s — exactly the expected 50Hz rate, zero loss |
   | D | All 4 reconnected via clips (direct, undoing B/C) | 1390 | 139 | 6 | Froze after ~2.8s of real data |
   | E | Same as D, repeated after confirming GND continuity with a multimeter | (not re-instrumented at this point; display frozen on checkmark again) | — | — | Froze again |
   | F | All 4 clips, **heartbeat-pixel diagnostic** on micro:bit (see below) | — | — | — | Heartbeat pixel blinked normally while showing the scanning diamond, then went **solid** at the exact moment the display froze on the checkmark |
   | G | Final: only P0/P1/GND (no 3V), micro:bit on battery bank's own port, clean firmware, no instrumentation | — | — | — | **Froze on the checkmark again** |

6. **A wiring-quality hypothesis was formed and then partly undermined.**
   Runs B vs C look like "disconnecting `3V`/`GND` fixed it", but B and C
   used *identical* wiring — the only thing that changed between them was a
   micro:bit reboot. That's a real confound: it's equally consistent with
   "the micro:bit intermittently stops on its own, for a variable and
   sometimes long duration, and a reboot temporarily clears it, independent
   of wiring." Multimeter continuity-tested every link in the `GND` chain
   (ESP32 pin → breadboard → jumper wire → alligator clip → micro:bit pad)
   with both boards unpowered: **every link was electrically sound and
   stable, including under gentle wiggling.** This rules out a simple
   broken/intermittent mechanical connection as the *sole* explanation,
   though it doesn't rule out a connection that's fine when static but
   marginal only under real dynamic load (voltage/current, not
   resistance).

7. **Button A test.** While frozen on the checkmark, pressed Button A on the
   micro:bit. Per `main.py`, this should trigger `capture_neutral()`, which
   calls `display.show(Image.TARGET)` — a call with **no dependency on any
   UART traffic at all**, purely local. Nothing happened; the display did
   not change. At the time this was read as evidence the micro:bit's own
   code must still be running (just not getting bytes across the wire),
   since a total code hang was assumed to be inconsistent with the observed
   burst-then-silence byte patterns above. **This reasoning has not been
   reconciled with finding 8 below and should be treated as open, not
   settled** — see "Open contradiction".

8. **Heartbeat-pixel diagnostic** (since reverted): a single corner pixel
   (`display.set_pixel(4, 0, ...)`) toggled every loop iteration, placed
   *after* the existing `display.show(ICONS.get(status, ...))` call so it
   overlays rather than gets immediately overwritten. This is a much easier
   thing for a human to passively watch for an extended period than trying
   to catch one of several possible frozen icons in a race. Result: the
   pixel blinked normally while the display showed the scanning diamond,
   and went **solid — stopped blinking — at the same moment the display
   transitioned to and froze on the checkmark.** This is direct evidence
   that **the micro:bit's main loop itself stops executing** at that point,
   not just that it stops receiving/displaying new status bytes.

   **Note:** an earlier, different diagnostic (four directional-arrow icons
   at intermediate checkpoints within one loop iteration, so that whichever
   one is left on screen pinpoints where in the iteration it hung) was
   flashed and briefly used, but was only ever actually observed *during a
   successful run* (the flawless run in row C), never during an actual
   freeze — the conclusion "no hang, none of the checkpoint icons are
   stuck" was drawn from the wrong data point and should not be trusted. It
   was reverted before ever being checked against a real freeze. If picking
   this back up, re-adding checkpoint icons (or reusing the heartbeat-pixel
   approach with multiple pixels, one per checkpoint) *during an actual
   freeze* would pinpoint which specific line of the loop it stops at,
   which is not yet known.

9. **Timing check against the finding-8 hang.** Asked whether the steering
   motor's movement (which starts once BLE calibration begins, a few
   seconds into the connection) coincided with the freeze. Answer: **the
   motor started moving *after* the display had already frozen** — i.e. the
   freeze predates any visible/mechanical motor activity. This still
   doesn't rule out BLE-radio current draw (connection handshake,
   subscribing to the steering port's notifications) as a trigger, since
   that happens before any motor moves — `docs/BRINGUP.md`'s own pre-existing
   warning about this class of problem explicitly mentions "the motors'
   BLE-side draw", not just mechanical movement. But it's also consistent
   with the freeze being triggered by something else entirely that happens
   at roughly the same point in the connection sequence (e.g. something
   about the *volume or exact byte content* of ESP32→micro:bit traffic right
   at that moment — `sendStatus(ST_CONNECTED)` is a distinctive one-off
   write, sent from a different code path than the periodic 5 Hz heartbeat).

10. **Brownout/shared-rail hypothesis tested directly and contradicted.**
    Based on 6/8/9 above and `BRINGUP.md`'s pre-existing warning, gave the
    micro:bit fully independent power (its own USB cable into the battery
    bank's second port) and removed the `3V`↔`3V3` wire entirely, keeping
    only `P0`/`P1`/`GND`. This is exactly the fix `BRINGUP.md` already
    recommended for this class of problem. **Result: froze on the checkmark
    again** (row G). This is the most recent and most important data point
    in this document — the leading hypothesis's own prescribed fix did not
    prevent the failure.

---

## Open contradiction (unresolved — read this before forming a new hypothesis)

- Finding 7 (Button A did nothing) was read as evidence *against* a full
  code hang.
- Finding 8 (heartbeat pixel goes solid exactly when the freeze happens) is
  direct evidence *of* a full code hang (the loop stops advancing at all,
  not just the UART-reading part of it).

These two observations were never reconciled. A hang thorough enough to stop
a totally UART-independent `display.show()` call from running (7) is hard to
square with... actually, re-reading 7: if the loop genuinely hangs, Button A
integration (`button_a.was_pressed()` is checked once per loop iteration)
would also stop being polled, which *would* explain why pressing it does
nothing — a hung loop can't check for a button press either. So finding 7 is
actually **consistent with** a genuine hang, not evidence against one; the
conclusion drawn from it at the time ("rules out a code hang") was wrong.
Whoever picks this up should treat findings 7 and 8 as **both pointing
toward a genuine main-loop hang**, not as contradictory — that earlier
conclusion was the analysis error, not the data.

## What's ruled out

- A code hang that only affects UART reading specifically — no, per the
  corrected reading of 7+8 above, this looks like the *entire* loop stops,
  every iteration's work included.
- A simple broken/intermittent mechanical connection in the `GND` chain —
  multimeter continuity-tested every link, all stable (finding 6). Doesn't
  rule out a connection that's fine when static but marginal only under
  real dynamic electrical load.
- The bench-test shim, the `flash.sh`/`build_bundle.py` changes, or
  `shaping.py` — none of these were involved in any of the failing
  configurations; `shaping.py` has its own passing unit tests and was never
  modified.

## What's NOT ruled out / worth trying next

- **A genuine, reproducible bug in `main.py`'s main loop**, specifically
  something that happens at or near the first real incoming byte on
  `Serial2`/`P1` (the ESP32's one-off `sendStatus(ST_CONNECTED)` write is a
  very consistent correlate across every failing run) — e.g. something in
  the `uart.any()`/`uart.read()` path, or a MicroPython/micro:bit firmware
  quirk specific to the less-common custom-pin UART configuration
  (`uart.init(tx=pin0, rx=pin1)`) that has never been exercised before this
  session.
- Re-run the heartbeat-pixel diagnostic (or a multi-checkpoint version of
  it) **and actually catch a freeze with it this time** — it was reverted
  before its checkpoint-icon predecessor was ever validated against a real
  failure, and the single-pixel heartbeat has only been observed freezing
  once (finding 8), not cross-checked against multiple checkpoints within
  the same iteration to say *which line* it stops on.
- Check the micro:bit's exact MicroPython/firmware version
  (`microbit.panic`/`os.uname()` equivalents) — this exact combination
  (custom-pin UART + accelerometer + display + button, wired to a real
  external device) had never run before this session per `BRINGUP.md`, so a
  firmware-level edge case is plausible and hasn't been checked.
- Consider whether the *content* of the very first bytes matters, not just
  the wiring/power: try feeding the micro:bit's `Serial2` input from
  something other than the ESP32 (e.g. the Mac harness or a script sending
  the exact same byte sequence including the one-off status=2 write) to see
  if the freeze is reproducible independent of the ESP32 entirely.
- Consider adding a `try/except` around the body of the main loop (or at
  least around the `uart`/`display` calls) purely as a diagnostic, to catch
  and report (via distinct display patterns, since USB serial is
  unavailable once `uart.init()` runs) any exception that might otherwise be
  silently swallowed or crash without the usual scrolling-sad-face handler
  engaging as expected.

## Unrelated fix made along the way (keep this, it's real and tested)

`microbit/flash.sh` + new `microbit/build_bundle.py`, currently uncommitted.
Fixes a genuine, separate, already-resolved bug: `uflash` only flashes one
script, and the previously-documented `microfs put` fallback for adding
`shaping.py` as a second file does not work with this codebase, because
`main.py`'s `uart.init(tx=pin0, rx=pin1)` kills USB REPL access almost
immediately after boot. `build_bundle.py` inlines `shaping.py`'s actual
source into `main.py` at flash time instead (verified byte-identical logic,
just concatenated), so `shaping.py` remains the single source of truth under
test (`test_shaping.py`, still passing) and no hand-maintained duplicate
ever needs to exist. Verified: `pio run -e esp32dev` and `pio test -e
native` both green throughout; the microbit test suite
(`python -m pytest test_shaping.py` from a project-local venv) also green. This
fix is unrelated to the freeze and should not be reverted or blamed for it.

---

## Resolution

### Root cause

The ESP32 sent its status as a **raw byte**: `Serial2.write(g_status)` with
`ST_CALIBRATING = 3`, i.e. the byte `0x03`. On the micro:bit, `main.py`'s
`uart.init(tx=pin0, rx=pin1)` does not create a second serial port; it
**redirects MicroPython's one and only console UART** onto `P0`/`P1`. From
then on every byte the ESP32 writes is the interpreter's *stdin*, and
`0x03` on stdin is **Ctrl-C**. While `main.py` runs, MicroPython arms Ctrl-C
as the interrupt character, so the first `CALIBRATING` byte raises
`KeyboardInterrupt` inside the main loop. The script ends. The display is
left holding whatever it last showed — the `CONNECTED` checkmark, because
`CALIBRATING` follows `CONNECTED` by about 2 ms and is the very next byte
the loop reads.

This is verbatim from both micro:bit firmware generations:

- **v1** (`bbcmicrobit/micropython`, `source/microbit/mphalport.cpp`): the
  UART RX interrupt handler does `if (c == mp_interrupt_char)
  mp_keyboard_interrupt(); else <push to stdin buffer>`. `main.cpp` calls
  `mp_hal_set_interrupt_char(3)` right before running the script.
  `microbituart.cpp`'s `uart.read()` reads via `mp_hal_stdin_rx_chr()`,
  i.e. from that same stdin buffer.
- **v2** (`microbit-foundation/micropython-microbit-v2`):
  `codal_app/microbithal.cpp` implements `uart.init(tx, rx)` as
  `uBit.serial.redirect(tx, rx)`; `codal_app/mphalport.cpp` implements
  `mp_hal_set_interrupt_char` as `uBit.serial.eventOn(<that char>)` with the
  event handler calling `mp_sched_keyboard_interrupt()`; `codal_port/main.c`
  sets `CHAR_CTRL_C` before `mp_call_function_0(module_fun)`;
  `microbit_uart.c`'s read path is `mp_hal_stdin_rx_chr()`.
- **Both** ports deliberately **do not show `KeyboardInterrupt` on the
  display** (`main.cpp` v1: "print exception to the display, but not if it's
  SystemExit or KeyboardInterrupt"; `main.c` v2: identical check). That is
  why there was no scrolling sad face: the usual crash handler engaged, it
  just has a special case for exactly this exception.

### Why every observation fits

| Observation | Explanation |
|---|---|
| Freezes on the checkmark, never reaches the clock | `2` displays; `3` (`0x03`) arrives next and kills the script before it can display the clock. |
| Heartbeat pixel goes solid at that exact moment (finding 8) | The loop stopped executing. It is a real, total halt — of the script, not the board. |
| Button A does nothing (finding 7) | Same: no script running to poll the button. Findings 7 and 8 agree. |
| No scrolling sad face | Deliberate firmware special case for `KeyboardInterrupt` (see above). |
| Never recovers on its own | After the script dies the micro:bit sits at the REPL. The ESP32 gets no frames, enters `FAILSAFE`, and sends `6` (`0x06`) forever — not a REPL control code, so nothing ever restarts the script. Deadlock. |
| Row C ran flawlessly after a reboot with identical wiring | The ESP32 had already finished calibrating (status `4`/`6`) when the micro:bit rebooted, so no `0x03` was ever sent during that run. `0x04`/`0x06` are harmless *while a script is running* (only the interrupt char is special then). Reboot "fixed" it only because it changed the byte sequence, not the wiring. |
| Rows B and D: N good frames then frozen, ESP32 at `6` | In each, the ESP32 (re)connected while the micro:bit was streaming, sent `2` then `3`, killed the script, then failed over. The frame counts are just how long the ESP32 took to connect. |
| Raw bytes keep arriving at the ESP32 with no good frames (row A, and rawBytes vs goodFrames generally) | The dying script prints its `KeyboardInterrupt` traceback and then a `>>> ` prompt to stdout — which is `P0`, the ESP32's `RX2`. Junk that never parses as a frame. |
| Removing `3V`/giving the micro:bit its own power did nothing (row G) | Power was never the cause. |

### The fix

Status now travels as the ASCII digit `'0'`..`'7'` (0x30..0x37): `statusToWire()`
in `esp32/lib/ctrl/protocol.{h,cpp}` (used by both `sendStatus()` and the 5 Hz
tick in `main.cpp`) and `decode_status()` in `microbit/shaping.py` (used by
`main.py`, returning `-1` -> `Image.SAD` for anything that is not a digit). No
byte in `0x00..0x1F` can reach the micro:bit's console any more, which also
removes the latent `0x04` (Ctrl-D, soft reset at the REPL) and `0x05`
(Ctrl-E, paste mode) hazards for `READY_DISARMED`/`ARMED`. Unit tests pin the
encoding on both sides (`test_protocol.cpp`, `test_shaping.py`). Verified
green: `pio test -e native` (31 tests), `pio run -e esp32dev`, `pytest
test_shaping.py` (16 tests), and `build_bundle.py`'s output compiles.

`micropython.kbd_intr(-1)` in `main.py` would also have suppressed the
symptom (both firmwares build with `MICROPY_KBD_EXCEPTION`), but it is
deliberately not used: it hides the problem instead of removing the control
byte from the wire, and it leaves the REPL-level hazards above in place.

### Hardware confirmation (done 2026-09-06, passed)

1. Flash both boards (`cd esp32 && pio run -e esp32dev -t upload`; `cd microbit && ./flash.sh`). Wire `P0`<->`GPIO16`,
   `P1`<->`GPIO17`, `GND`<->`GND` (3V optional; power was never the issue).
2. Expected: diamond -> (checkmark for a blink, or not visible at all) ->
   clock for the sweep -> small square. Press A -> heart. The display must
   keep changing past the checkmark.
3. Optional proof of the *old* cause, if wanted: with the old firmware, tap
   the ESP32 monitor's raw `Serial2` input as text after the freeze — it
   contains `KeyboardInterrupt` and `>>> `.
