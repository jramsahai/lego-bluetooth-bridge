# lego-bt-bridge

Tilt a BBC micro:bit, drive a LEGO Technic 42160 (Audi RS Q e-tron). The
official LEGO CONTROL+ phone app is fine at its job but unpleasant to use as a
controller, so this replaces it with an accelerometer and two AA-scale
microcontrollers, without touching the car itself.

The system is three small components, each independently testable, connected
by two well-defined interfaces: an ASCII serial protocol and Bluetooth Low
Energy.

## The car is never modified

Nothing here flashes the Technic Hub, patches its firmware, or pairs with it
in any way the CONTROL+ app would notice. The hub (LEGO Technic Hub 88012)
speaks LEGO Wireless Protocol 3.0 over BLE with no pairing and no
authentication, and the official app is just one more BLE client sending it
port-output commands. This project is another such client. That means:

- Nothing to undo, ever.
- To go back to the phone app: power-cycle the car, open CONTROL+. That's it.
  There is no firmware to reflash and no state left behind on the hub.

## Architecture

```
+-------------+  ASCII frames   +--------------+   BLE / LWP3    +--------------+
|  micro:bit  |  50 Hz, 115200  |    ESP32     |  (via Legoino)  |  Technic Hub |
|             | --------------> |              | --------------> |    88012     |
| accel read  | <-------------- | frame parse  |                 |              |
| neutral cal |  status byte    | steer calib  |                 |   3 motors   |
| LED feedback|     5 Hz        | failsafe     |                 |              |
+-------------+                 +--------------+                 +--------------+
    P0/P1/GND                     GPIO16/17

              +----------------------------------+
              |  mac-harness/  (Node, dev only)  | --BLE--> same hub
              |  port discovery, steering probe, |
              |  keyboard driving, protocol log  |
              +----------------------------------+
```

- **`microbit/`** — MicroPython on the micro:bit. Reads the accelerometer,
  shapes tilt into steer/throttle values, and sends one ASCII frame per
  sample over UART. Knows nothing about LEGO or Bluetooth. Displays the
  ESP32's status byte as an icon, since the micro:bit is the only thing here
  with a screen.
- **`esp32/`** — the BLE central. Holds the connection to the hub, runs
  steering calibration on every connect, parses frames from the micro:bit,
  applies failsafes, and drives the motors via
  [Legoino](https://github.com/corneliusmunz/legoino). Knows nothing about
  accelerometers.
- **`mac-harness/`** — a Node.js tool that runs on the Mac and talks to the
  hub directly over its own Bluetooth, using
  [`node-poweredup`](https://github.com/nathankellenicki/node-poweredup). It
  exists to discover which port is which, prove out the steering-calibration
  algorithm, and let you drive the car from the keyboard before any embedded
  code is trusted. It's a permanent tool, not scaffolding to delete — reach
  for it any time you need to debug the car independent of the rest of the
  stack.

## Wiring

| micro:bit | ESP32          | Purpose                    |
|-----------|----------------|-----------------------------|
| `P0`      | `GPIO16` (RX2) | frames, micro:bit -> ESP32 |
| `P1`      | `GPIO17` (TX2) | status, ESP32 -> micro:bit |
| `GND`     | `GND`          | common ground               |
| `3V`      | `3V3`          | power for the micro:bit     |

Both boards run 3.3 V logic, so the UART lines connect directly — no level
shifting needed. A single USB power bank feeds the ESP32; the ESP32's onboard
regulator feeds the micro:bit through its `3V` pad.

> **Never plug the micro:bit's USB cable in while it is powered from the
> ESP32's `3V3` pin.** Doing so back-feeds the micro:bit's onboard regulator
> from two directions at once. Disconnect the ESP32-side power (or the
> `3V`/`GND` wires) before connecting USB for reflashing or debugging.

Note for anyone substituting hardware: GPIO16/17 are free on ESP32-WROOM
modules but are claimed by PSRAM on WROVER modules — if you use a WROVER,
move UART2 to different pins and update `esp32/include/hw_config.h`.

## Running each piece

### mac-harness (Mac, dev tool)

```bash
cd mac-harness
npm install
npm run discover        # which port is which
npm run calibrate       # sweep the steering to its end stops, measure the range
npm run selftest        # scripted direction check, no keyboard needed
npm run drive           # keyboard driving (needs a real terminal)
npm run firmwarecmds    # replay the ESP32 firmware's exact motor commands, report what the hub does
npm run trace           # log every BLE byte while reproducing the old port A fault
```

Defaults are the values measured against the car (`docs/hardware-map.md`).
Environment variables, all optional:

| Variable           | Default       | Meaning                                                          |
|--------------------|---------------|------------------------------------------------------------------|
| `STEER_PORT`       | `D`           | hub port letter of the steering motor                            |
| `DRIVE_PORTS`      | `A,B`         | hub port letters of the two drive motors                         |
| `DRIVE_INVERT`     | `false,false` | per-drive-motor direction inversion, one per `DRIVE_PORTS` entry |
| `STEER_INVERT`     | `false`       | invert the steering direction                                    |
| `MAX_SPEED`        | `70`          | `drive`: motor power at full throttle (up to 100)                |
| `MIN_POWER`        | `25`          | `drive`: motor power at the first throttle step                  |
| `SKIP_CALIB`       | unset         | `drive`: `1` skips the steering sweep and uses `STEER_HALF_RANGE` |
| `STEER_HALF_RANGE` | `105`         | `drive`: steering half-range used when the sweep is skipped      |

`npm run drive` controls: `W`/`S` (or up/down) throttle in steps and latch,
`A`/`D` (or left/right) steer, `C` centre the steering, `SPACE` stop and
straighten, `Q` or Ctrl-C quit. Every stop is verified against the motor
encoders and reported. Car on a stand with the wheels off the ground.

All motor commands are written directly to the hub by `src/rawmotor.js`,
using the same bytes the ESP32 firmware sends, rather than through
node-poweredup's command queue. That queue can wedge a port for a whole
session; see `docs/OPEN-ISSUE-port-a.md`. The remaining scripts under
`src/` are diagnostics from that investigation and are listed in the same
document.

### ESP32 (PlatformIO)

This machine has PlatformIO installed in a project-local virtualenv at
`./.venv/bin/pio`; if you have `pio` on your `PATH` instead, drop the
`../.venv/bin/` prefix from the commands below.

```bash
cd esp32
../.venv/bin/pio run -e esp32dev -t upload   # build and flash
../.venv/bin/pio device monitor              # watch boot/connect/calibrate logs
```

(Or, with a global install: `pio run -e esp32dev -t upload && pio device monitor`.)

### micro:bit

```bash
cd microbit
python3 -m venv .venv && .venv/bin/pip install uflash pytest   # once
./flash.sh
```

`flash.sh` prefers `microbit/.venv` if it exists (this Mac's system Python is
externally managed), otherwise whatever `python3` is on your `PATH`. It runs
`build_bundle.py`, which inlines `shaping.py` into `main.py` at flash time
and flashes the result as one script — `uflash` only ever flashes a single
file, and putting `shaping.py` on the device separately with `microfs` does
not work here, because `main.py`'s `uart.init(tx=pin0, rx=pin1)` takes the
USB REPL away almost immediately after boot. `shaping.py` stays the single
source of truth and stays under test; nothing hand-copied is ever flashed.

Unplug the micro:bit from the ESP32's `3V` before connecting its USB cable
to flash (see the wiring note above).

## Status-icon legend

The ESP32 has no display of its own, so it reports its state as a single
byte at 5 Hz, which the micro:bit renders on its LED matrix. On the wire the
status travels as the ASCII digit `'0'`..`'7'` (0x30..0x37), **never as the
raw value**: the micro:bit's `uart.init(tx=pin0, rx=pin1)` puts MicroPython's
own console on `P1`, so a raw `0x03` (`CALIBRATING`) is Ctrl-C to it and
silently kills `main.py` — see `docs/OPEN-ISSUE-microbit-freeze.md`.

| Status | Wire byte | ESP32 state      | micro:bit icon (`Image.*`) |
|--------|-----------|------------------|------------------------------|
| 0      | `'0'`     | `BOOT`           | `DIAMOND_SMALL`              |
| 1      | `'1'`     | `BLE_SCANNING`   | `DIAMOND`                    |
| 2      | `'2'`     | `CONNECTED`      | `YES`                        |
| 3      | `'3'`     | `CALIBRATING`    | `ALL_CLOCKS[0]`              |
| 4      | `'4'`     | `READY_DISARMED` | `SQUARE_SMALL`               |
| 5      | `'5'`     | `ARMED`          | `HEART`                      |
| 6      | `'6'`     | `FAILSAFE`       | `NO`                         |
| 7      | `'7'`     | `ERROR`          | `SKULL`                      |

Any other byte (a non-digit, or a digit with no icon) shows `Image.SAD`, but
that requires an actual unrecognized byte to arrive over UART — it is not
what you see before anything has been sent. With nothing yet wired to
`P0`/`P1` (e.g. micro:bit powered up standalone), `status` simply stays at
its initial value of 0, so the display shows `DIAMOND_SMALL` (the `BOOT`
icon), not `SAD`.

## Running the tests

Three independent suites, one per component that has logic worth testing on
a desktop:

```bash
# mac-harness: steering math, stall detection, raw motor command bytes,
# and the node-poweredup queue wedge reproduction
cd mac-harness && npm test

# ESP32: frame parsing/checksum, status wire encoding, steering/slew math,
# the drive power band and the motor command bytes; no hardware or Arduino needed
cd esp32 && ../.venv/bin/pio test -e native

# micro:bit: tilt shaping (clamp, deadzone, expo), frame building, status decoding
cd microbit && .venv/bin/python -m pytest test_shaping.py
```

(Use `python3 -m pytest test_shaping.py` for the last one if you aren't using
the `microbit/.venv` that `flash.sh` also uses.)

## Controls

- **Tilt roll** (side-to-side, read on the accelerometer's X axis) steers.
- **Tilt pitch** (forward/back, read on the accelerometer's Y axis) throttles.
  Any tilt past the deadzone drives the motors at no less than
  `DRIVE_MIN_POWER` (25%, `esp32/include/hw_config.h`): below that a geared
  LEGO motor stalls against its own gearing and whines instead of turning,
  so throttle maps onto the 25..100 band rather than 0..100. Level is still
  exactly zero.
- **Button A** captures the micro:bit's current orientation as the new
  neutral (resting/level) position. Hold the micro:bit however feels natural,
  then press A once before driving.

**The car boots disarmed.** Power it up and it will not move — the ESP32
starts with its own arm latch clear, and only sets it on receipt of a frame
with a fresh button-A press *after* steering calibration has completed. This
is deliberate: it means powering everything up while sitting on a table, or a
brief signal dropout mid-drive, can never make the car move on its own. Press
button A once (after the status icon shows `READY_DISARMED`, not before) to
arm it and start driving.
