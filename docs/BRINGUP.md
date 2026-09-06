# Bring-up: what still has to happen

Everything in this repo is built and unit-tested. **None of it has touched
real hardware.** This document exists because that is the single most
important thing to understand before you plug anything in. Read it before you
touch the car.

## What "finished but unproven" actually means here

- **`esp32/` has never been compiled for the target.** The `native`
  PlatformIO environment — pure C++ logic with no `Arduino.h`, no BLE, no
  Legoino — builds and passes (`pio test -e native`, 21 test cases). The
  `esp32dev` environment, which is the actual firmware (`esp32/src/main.cpp`,
  which includes `Arduino.h` and `Lpf2Hub.h`), has never been built. There is
  no ESP32 board and no LEGO car in the environment this was written in.
  `platformio.ini` names `corneliusmunz/Legoino` as a dependency but it has
  never actually been fetched or linked — `.pio/libdeps/` on this machine
  contains only the native test environment's `Unity` framework, nothing for
  `esp32dev`. That means **every Legoino API call in `main.cpp`** —
  `setTachoMotorSpeed`, `stopTachoMotor`, `setAbsoluteMotorPosition`,
  `setAbsoluteMotorEncoderPosition`, `activatePortDevice`, `parseTachoMotor`,
  `connectHub`, `isConnecting`/`isConnected`, `getDeviceTypeForPortNumber` — is
  unverified against the real library. The code was written by reading
  Legoino's documented API; it has not been checked against the library's
  actual headers, and PlatformIO has never had the chance to reject a
  misremembered signature because it has never tried to compile that
  environment.
- **The hardware constants are placeholders**, not measurements. See below.
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

## The hardware constants are unverified placeholders

`esp32/include/hw_config.h` says so at the top of the file, in block
comments, and it is correct:

```
HW_STEER_PORT       = 0     // "A"
HW_DRIVE_PORTS[2]   = {1, 2}  // "B", "C"
HW_DRIVE_INVERT[2]  = {false, true}
HW_STEER_INVERT     = false
```

These were transcribed from `mac-harness/hardware-constants.json`, which
itself says `"verified": false` and explicitly labels itself as "the brief's
example values, not measurements." **`steerHalfRange` (63, in that same JSON
file) never made it into `hw_config.h` at all** — the firmware computes its
own half-range at runtime from the physical calibration sweep
(`computeSteerRange` in `esp32/lib/ctrl/control.cpp`), so there's no baked-in
number to correct there, but the four constants above (which port is which,
and which drive motor is mounted backwards) absolutely must be corrected
before you trust the firmware to touch the real car — a wrong port number
means the firmware will spin the wrong motor as "steering," which is the
scenario the timeout-and-give-up logic exists to survive, not something
you want to rely on in practice.

### How to get real values

1. **`cd mac-harness && npm install`** (if not already done).
2. **`npm run discover`** — car on a stand, wheels off the ground, hub green
   button pressed. This connects over your Mac's own Bluetooth and prints the
   device type attached to each of the hub's four ports. Two ports will share
   a device class (the drive motors); one will be different (the steering
   motor, a tacho/absolute motor). Write this down.
3. **`STEER_PORT=<letter> npm run calibrate`** using the port you just
   identified as steering. This sweeps it to both end stops, computes
   `center`/`halfRange`, drives to center, and zeros the encoder there. Run it
   twice; the two `halfRange` values should agree within a few degrees. If
   they don't, or if it throws "sweep never stalled — wrong steering port?",
   you picked the wrong port — go back to step 2.
4. **`STEER_PORT=<letter> DRIVE_PORTS=<letter>,<letter> npm run drive`** —
   keyboard-drive the car. Press `W`. Both drive wheels must turn the *same*
   way. If they fight each other, one motor is mounted mirrored; re-run with
   `DRIVE_INVERT=false,true` (or whichever combination makes `W` drive both
   wheels forward together). Press `A`/`D` and confirm `A` steers left; if
   it's backwards, note `steerInvert: true`.
5. **Record the results** in two places:
   - `docs/hardware-map.md` (does not exist yet — create it) with the literal
     `discover` output and your reading of which port is which, following the
     template already sketched in
     `.superpowers/sdd/2026-09-05-microbit-lego-controller/task-1-brief.md`.
   - `mac-harness/hardware-constants.json` — replace every field with your
     measured values and flip `"verified"` to `true`.
6. **Transcribe** the confirmed `steerPort`, `drivePorts`, `driveInvert`, and
   `steerInvert` from `hardware-constants.json` into
   `esp32/include/hw_config.h` (`HW_STEER_PORT`, `HW_DRIVE_PORTS`,
   `HW_DRIVE_INVERT`, `HW_STEER_INVERT`), converting port letters to numbers
   (A=0, B=1, C=2, D=3 — the mapping the header already documents). Update
   the block comment at the top of the file once this is done so the next
   reader doesn't have to re-derive that it's now real.

Do not skip straight to flashing the ESP32 with the placeholder values "to
see what happens" — a wrong `HW_STEER_PORT` means the calibration sweep spins
whatever is actually attached to that port at power for up to 3 seconds per
direction, twice, before giving up. On a drive motor or an unused port that's
merely pointless; if the port map is subtly wrong in some other way it's a
needless risk to the gearbox for no information you don't already get more
safely from the harness.

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

The firmware still uses `stopTachoMotor` rather than `stopBasicMotor`, and that
change stands - but on different grounds than originally claimed. It rests on
reading Legoino's source, not on the flawed measurement: `stopBasicMotor` is
`setBasicMotorSpeed(port, 0)`, which sends a raw power value with no braking
style, while `stopTachoMotor` routes through `setTachoMotorSpeed` with
`BrakingStyle::BRAKE`. These are tacho motors with encoders, so the tacho
command is the right API family for them either way.


## Hardware finding: consecutive motor commands race, and one is dropped

This is the most important thing the harness found, and it applies to the
firmware as much as to the Mac scripts.

Braking two motors in a tight loop does not work. Bisected on the real car:

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

**Never issue two motor commands back to back.** Separate them in time: 20 ms
in the harness, `delay(15)` in the firmware. Either is ample and costs nothing
against the 200 ms failsafe budget.

**Do NOT try to fix this by awaiting the library call.** node-poweredup's motor
methods return a promise that never settles, so `await motor.brake()` deadlocks
the script - with the car still driving, which is worse than the original bug.
This was tried and it hung the test harness mid-run with the wheels turning.
Await a timer, never the library.

`stopEverything()` additionally sends the whole stop pair twice. A stop is the
one command worth repeating, and this is exactly the failure it guards against:
without it, a failsafe would have stopped one axle and left the car driving on
the other.
