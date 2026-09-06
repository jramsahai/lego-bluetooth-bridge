# Bring-up: what still has to happen

> **Port A issue — root cause found and confirmed on the car.** Port A
> "ignoring" commands was node-poweredup's per-port command queue wedging on
> the Mac: when a second write to the hub is issued before the first one's BLE
> acknowledgement (~55 ms) returns, the BLE layer drops the first write's
> callback, node-poweredup never moves that command out of its queue, and it
> never writes another command for that port. The hub kept running the last
> power it had received. Seen byte-for-byte with `npm run trace`, reproduced
> offline in `mac-harness/test/poweredup-queue.test.js`, and fixed by writing
> motor commands directly (`mac-harness/src/rawmotor.js`). The ESP32 firmware
> (Legoino) writes without waiting for acknowledgements and has no such queue,
> so it is not affected. See `docs/OPEN-ISSUE-port-a.md`.

Everything in this repo is built and unit-tested. **None of it has touched
real hardware.** This document exists because that is the single most
important thing to understand before you plug anything in. Read it before you
touch the car.

## What "finished but unproven" actually means here

- **`esp32/` compiles for the target (first built 2026-09-05, Legoino 1.1.0),
  but has never run on a board.** `pio run -e esp32dev` succeeds, so every
  Legoino call in `esp32/src/main.cpp` matches the library's real headers.
  The `native` environment (pure C++ logic, 29 test cases) also passes. There
  is still no ESP32 board and no observation of the firmware on hardware.

  Getting that first build to pass needed one change, and it was not in
  `main.cpp`: Legoino 1.1.0 declares `depends=NimBLE-Arduino` with no version
  bound, so PlatformIO resolved NimBLE-Arduino 2.5.1 and Legoino itself failed
  to compile against it (`getClientListSize`, `setScanResponse`, `setPower`
  and the `NimBLEAddress`/`addData` string overloads all changed in NimBLE
  2.0). `platformio.ini` now pins `h2zero/NimBLE-Arduino@^1.4.2`, the line
  Legoino was written for. Every Legoino signature `main.cpp` uses was correct
  as written and needed no edit.
- **The hardware constants are measured** (`docs/hardware-map.md`). See below.
- **`microbit/main.py` has only been syntax-checked.** It has never run on a
  micro:bit. `microbit/shaping.py` — the pure math it depends on — is
  genuinely well-tested (`test_shaping.py`, 14 cases, desktop pytest), but the
  glue in `main.py` (`uart.init`, `accelerometer.get_x/get_y`,
  `button_a.was_pressed`, `display.show`, the `microbit.Image` constants) has
  never executed on real hardware.
- **Nothing about BLE pairing, UART timing between two real boards, motor
  behavior, or power draw has been observed.** All of that is inference from
  reading LEGO Wireless Protocol / Legoino documentation and BBC micro:bit
  documentation, not from a scope or a serial monitor attached to the real
  thing.

None of this means the code is bad — the parts that could be tested off
hardware (frame parsing, checksum, steering-range math, stall detection,
slew limiting, tilt shaping) are genuinely covered, in three independent
suites, and pass. It means the parts that *couldn't* be tested off hardware
are completely unproven, and you should treat every claim below about "what
happens on first power-up" as a prediction, not a report.

## The hardware constants are measured

`esp32/include/hw_config.h` carries values measured against the real car on
2026-09-05 and says so at the top of the file:

```
HW_STEER_PORT       = 3            // "D"
HW_DRIVE_PORTS[2]   = {0, 1}       // "A", "B"
HW_DRIVE_INVERT[2]  = {false, false}
HW_STEER_INVERT     = false
```

How they were established, and the steering span (234-235 degrees, half-range
105), is recorded in `docs/hardware-map.md`, with the matching values in
`mac-harness/hardware-constants.json` (`"verified"` is a description of that
measurement, not a flag). The firmware re-measures the steering range on
every connect, so no half-range is compiled in.

If the car is rebuilt or a motor is moved to another port, redo the
measurement with the harness before flashing: `npm run discover` for the port
map, `npm run calibrate` to prove which port stalls at end stops (the steering
motor; a drive motor spins for the full timeout), `npm run selftest` for the
directions, then update `hw_config.h`, `hardware-constants.json` and
`docs/hardware-map.md` together. Do not flash with guessed values: a wrong
`HW_STEER_PORT` sweeps whatever is on that port at power for up to three
seconds in each direction.

## `microbit/main.py` has never run on a micro:bit

The logic it depends on (`shaping.py`) is tested; the glue that reads the
accelerometer, drives the UART, and updates the display is not. Two things to
expect:

- **`uflash` flashes exactly one script.** `microbit/flash.sh` runs
  `python3 -m uflash main.py` and says so in its own output. `main.py` does
  `from shaping import shape_axis, build_frame, EXPO_STEER, EXPO_THROTTLE` —
  if `uflash` does not also bundle `shaping.py` onto the device, that import
  fails at boot.
- **How you'll know:** flash with the micro:bit on USB only (not yet wired to
  an ESP32) and watch the display. Expected sequence with `shaping.py`
  correctly bundled: the target icon (`Image.TARGET`, during the initial
  neutral capture) appears first, then it clears and settles on
  `Image.DIAMOND_SMALL` — the `BOOT`/`BLE_SCANNING` icon for status byte 0 —
  and stays there, because nothing is connected to `P0`/`P1` to ever change
  `status` away from its initial value. `Image.SAD` does not appear on this
  path at all; it's only `main.py`'s fallback for a status byte outside
  0-7, which silence cannot produce. If `shaping.py` was *not* bundled, the
  symptom looks completely different: `main.py`'s
  `from shaping import ...` fails at the top of the script, before the
  target icon or anything else is ever shown, so you'll see a scrolling
  MicroPython `ImportError` instead — not `Image.SAD`, and not even the
  target icon.
- **The fix** (pick one):
  1. Inline the contents of `shaping.py` directly into the top of `main.py`,
     replacing the `from shaping import ...` line. Leave a comment noting
     it's a duplicate of `shaping.py`, which stays the source of truth (and
     stays under test).
  2. Use `microfs` to put both files on the device's filesystem instead of
     `uflash`:
     ```bash
     python3 -m pip install microfs
     cd microbit
     python3 -m microfs put shaping.py
     python3 -m microfs put main.py
     ```

## Bring-up order

Do every step here with the car on a stand, wheels off the ground, except
the last. This mirrors the staged manual-testing plan in the design spec
(`docs/superpowers/specs/2026-09-05-microbit-lego-controller-design.md`),
which stages the three components so each stage isolates exactly one new
interface.

1. **Harness drives the car** (no ESP32, no micro:bit). This is the "get real
   hardware constants" work above: `npm run discover`, `npm run calibrate`,
   `npm run drive`. Validates BLE, port discovery, and the calibration
   algorithm using a version of it that's had a REPL and real logs in front
   of it. Exit criteria: you can drive the car from the Mac keyboard, and
   `hardware-constants.json` holds real, agreeing, `verified: true` numbers.
2. **ESP32 drives the car from hand-typed serial frames** (no micro:bit).
   Build and flash with the corrected `hw_config.h`:
   ```bash
   cd esp32
   ../.venv/bin/pio run -e esp32dev -t upload
   ../.venv/bin/pio device monitor
   ```
   Confirm in the monitor: `[ble] connected`, then a calibration sweep that
   sounds and looks like the one the harness just did (span within a few
   degrees of what you measured), then a settle at center. Then type frames
   by hand into the serial monitor's send line (see the checksum section
   below) and confirm the car responds: steering moves proportionally,
   throttle ramps rather than snapping, and stopping input for ~200 ms
   triggers `FAILSAFE`. This validates the BLE half of the firmware and the
   frame parser with zero micro:bit involvement — if something's wrong here,
   it's in `main.cpp`/`control.cpp`/`protocol.cpp`, not in the wiring or the
   micro:bit.
3. **Full stack.** Wire the micro:bit to the ESP32 per the README's wiring
   table, power both from the same bank, and confirm the LED status icon
   matches what the serial monitor says the ESP32's state is. The protocol's
   byte sequence is `BOOT` -> `BLE_SCANNING` -> `CONNECTED` -> `CALIBRATING`
   -> `READY_DISARMED`, but `CONNECTED` is sent once and superseded roughly
   2 ms later by `CALIBRATING`, before the micro:bit's next UART read —
   it's a real, transient state in the protocol, just not one you should
   expect to actually see rendered. What you should observe on the display
   is: the scanning icon (`Image.DIAMOND`), then the calibrating clock
   (`Image.ALL_CLOCKS[0]`) for the several seconds of the sweep, then the
   disarmed square (`Image.SQUARE_SMALL`). Then press button A and confirm
   the heart (`ARMED`) and the wheels responding to tilt. This
   is the only stage that validates the micro:bit code and the physical
   wiring together, so it's the only stage that can surface a wiring mistake
   or a micro:bit bug — do it last, and only once stages 1 and 2 both work.
4. **Wheels down, on the ground, only after stage 3 is clean** on the stand.
   Start with the car pointed at open space, not toward furniture, feet, or a
   drop — this is the first moment any of this software has ever actually
   propelled the car under its own power.

## Hand-computing a frame checksum

For stage 2, you need to type frames like `!<steer>,<throttle>,<flags>*<XX>`
into a serial terminal by hand. The checksum `<XX>` is the XOR of every
character strictly between `!` and `*`, rendered as two uppercase hex digits.
One-liner:

```bash
python3 -c "
body = '-42,80,1'
c = 0
for ch in body:
    c ^= ord(ch)
print('%02X' % c)
"
```

Worked examples (computed with the command above, and cross-checked against
`microbit/test_shaping.py` and `esp32/test/test_protocol/test_protocol.cpp`,
which both assert this exact value):

| Frame body    | Checksum | Full frame        | Meaning                                    |
|---------------|----------|--------------------|---------------------------------------------|
| `-42,80,1`    | `12`     | `!-42,80,1*12`     | steer left 42, throttle forward 80, armed  |
| `0,0,1`       | `31`     | `!0,0,1*31`        | centered, zero throttle, armed — a good first frame to send: it should hold the wheels straight and the drive motors stopped, and (if calibration is done) refresh the failsafe timer without moving anything |
| `0,0,0`       | `30`     | `!0,0,0*30`        | centered, zero throttle, **not armed**     |
| `30,-50,3`    | `18`     | `!30,-50,3*18`     | steer right 30, reverse 50, armed + recal flag set |

A malformed or wrong-checksum frame is dropped silently by the parser and,
deliberately, does **not** refresh the failsafe timer — so if you mistype a
checksum while testing, expect the car to drift toward `FAILSAFE` rather than
do something unexpected.

## What to watch for on first power-up

- **A brownout looks like the micro:bit rebooting.** If the boot icon
  (`Image.DIAMOND_SMALL`) reappears on the micro:bit's display at the exact
  moment the drive motors start drawing current, that's the ESP32's 3.3 V
  regulator sagging under the combined load of the motors' BLE-side draw and
  the micro:bit riding on the same rail, not a software bug. The design spec
  flags this as a known risk (an ESP32 onboard regulator rated for a few
  hundred mA feeding a micro:bit that draws tens of mA is probably fine but
  was never measured). If you see it: power the micro:bit from its own
  separate battery/USB source instead, and keep only `P0`, `P1`, and `GND`
  shared between the two boards (no `3V`). Don't try to fix it by only
  reducing motor power — measure or swap the supply first.
- **The steering-calibration ERROR latch.** After 3 consecutive failed
  calibration attempts (each attempt times out after ~3 seconds per sweep
  direction if the motor never stalls), the firmware sets a permanent
  `g_calibLatchedError` flag, stops touching the steering motor, and reports
  status `ERROR` (icon: skull) until the next reconnect. This is
  `MAX_CALIB_ATTEMPTS` in `esp32/src/main.cpp`. The usual cause is a wrong
  `HW_STEER_PORT` — the firmware is sweeping a drive motor or an empty port
  and it simply never stalls the way a real steering motor against its end
  stops does. Reconnecting the hub (power-cycle the car, or otherwise force
  a BLE disconnect/reconnect) resets the attempt counter and gives the
  firmware a fresh set of 3 tries — it does not require reflashing. If you
  hit `ERROR` on the very first real run, stop and re-check
  `HW_STEER_PORT` against `docs/hardware-map.md` before retrying; burning
  through all 3 attempts on the same wrong port teaches you nothing new after
  the first.


## Hardware finding: both stop commands work (an earlier claim here was wrong)

An earlier version of this document stated that `setPower(0)` only coasts while
`brake()` stops the motor. **That was wrong**, and it was wrong because of a bad
measurement, so it is worth recording how.

The first test called `setPower(0)`, measured 56 degrees of rotation, then called
`brake()` and measured 0 - and concluded brake was the one that worked. But the
measurement began the instant each command was sent, so it counted the motor's
deceleration as "still turning", and by the time `brake()` was called the motor
had already spent 1.5 seconds coasting to a near stop. The test credited brake
with a stop that had already happened.

Re-measured with a 900 ms settling delay before judging:

```
  setPower(0)    running= 585  during-stop=  69  AFTER=   0  <-- fully stopped
  brake()        running= 595  during-stop=  33  AFTER=   0  <-- fully stopped
```

**Both commands fully stop the motor.** `brake()` is somewhat more abrupt (33
degrees of stopping transient against 69), which is a reason to prefer it, but
either one stops the car.

The lesson worth keeping: when timing a physical process, let it settle before
judging it, or you measure the transient instead of the outcome.

### What this means for the firmware

The firmware's stop is `brakeMotor()` in `esp32/src/main.cpp`: StartPower with
value 127, the same bytes `brake()` sends from the Mac harness and the one
stop that has been measured on the car. It does **not** use Legoino's
`stopTachoMotor`. That function sends sub-command `0x01` followed by
max-power, brake-style and profile bytes; in LWP3, `0x01` is a one-byte
StartPower, so those trailing bytes are not part of any command and the hub's
response to them is not defined by the spec. `npm run firmwarecmds` in the
harness sends those exact bytes, and on 2026-09-06 the hub tolerated them:
Legoino's sweep bytes (speed byte 37) drove the steering to the same end stop
the validated sweep finds, and Legoino's stop bytes (speed byte 127) brought
both drive motors from ~230 degrees per half second to zero, with no Generic
Error from the hub. So this hub reads the first payload byte of the `0x01`
form as StartPower and ignores the rest. The firmware still does not rely on
that: it sends the spec-defined bytes, pinned by test to the harness's. The
calibration sweep likewise uses raw StartPower at 30, as the harness sweep
does, instead of `setTachoMotorSpeed`.

Every motor command the firmware sends is built by `esp32/lib/ctrl/lwp3.cpp`
and written with Legoino's raw `WriteValue`, not through Legoino's motor
helpers. Those helpers rescale power and speed through `MapSpeed` (0 becomes
127, 1..100 becomes 1..126, -1..-100 becomes 255..128), so `setBasicMotorSpeed(port, 100)`
puts 126 on the wire, a value LWP3 does not define for StartPower and the car
has never been shown to obey. `test/test_lwp3` pins the firmware's bytes to the
same vectors as `mac-harness/test/rawmotor.test.js`, so what the firmware sends
is exactly what the harness has measured on the car.


## Hardware finding: "consecutive motor commands race" was a Mac library bug

> **Superseded.** The explanation in this section - that the hub drops one of
> two back-to-back writes - was wrong. The measurements below are real, but the
> mechanism is node-poweredup's per-port command queue wedging, after which the
> library silently stops writing to that port for the rest of the session. See
> `docs/OPEN-ISSUE-port-a.md`. The harness now bypasses that queue
> (`mac-harness/src/rawmotor.js`). Legoino on the ESP32 writes directly and has
> no such queue, so this does not apply to the firmware; its `delay(30)` spacing
> is kept as cheap insurance, not as a fix. The original text follows for the
> record.

Braking two motors in a tight loop did not work. Bisected on the real car:

```
  1. one motor,  one speed,  no steer cmd         0  stopped
  2. TWO motors, one speed,  no steer cmd       536    0  <<<< STILL TURNING
  3. TWO motors, TWO speeds, no steer cmd       514    0  <<<< STILL TURNING
  4. TWO motors, TWO speeds, WITH steer cmd     532    0  <<<< STILL TURNING
```

One motor brakes reliably. With two, the FIRST motor keeps running at full
speed and only the SECOND actually stops. Adding speed changes or steering
commands changes nothing - two consecutive commands is the entire trigger.

Both node-poweredup and Legoino write to the hub over BLE **without waiting for
a response**, so two commands issued in immediate succession race and one is
silently lost. Nothing reports an error; the command simply never takes effect.

### The rule

**Never issue two motor commands back to back - including the ones that START
the motors.** This is the part that took longest to find: spacing only the stop
commands does NOT help. Two `setPower` calls fired in the same tick leave that
port ignoring every later command, so the stop fails long afterwards and looks
like a broken stop.

Bisected on the real car: with the two starting commands 60 ms apart, every stop
method worked - brake first, brake in reverse order, even a plain `setPower(0)`.
With them unspaced, nothing would stop the first motor.

Use 40 ms in the harness and `delay(30)` in the firmware. 20 ms was measured as
not enough.

**Do NOT try to fix this by awaiting the library call.** node-poweredup's motor
methods return a promise that only settles on hub feedback, so on a wedged port
`await motor.brake()` never returns - with the car still driving, which is worse
than the original bug. This was tried and it hung the test harness mid-run with
the wheels turning. (The promises from `rawMotor` settle on the BLE write
acknowledgement and are safe to await.)

`stopEverything()` additionally sends the whole stop pair twice. A stop is the
one command worth repeating, and this is exactly the failure it guards against:
without it, a failsafe would have stopped one axle and left the car driving on
the other.
