# Bring-up procedure and hardware findings

The full stack was run on the car on 2026-09-06: harness driving, the ESP32
driven from hand-typed frames, the wired micro:bit and ESP32 pair, and tilt
control on the car itself. This document is the procedure for the next time
something changes (a rebuilt car, a moved motor, a new board) and the record
of what was learned on hardware along the way.

Do not skip the staged order below when something changes. Each stage
isolates one interface, which is what made the hardware bugs quick to
pin down.

## Bugs found on hardware

Each of these is recorded in detail elsewhere; this is the index.

- **Port A stopped accepting commands from the Mac harness.** The cause was
  node-poweredup's per-port command queue. When a second write to the hub is
  issued before the first one's BLE acknowledgement (about 55 ms) returns,
  the BLE layer drops the first write's callback, node-poweredup never moves
  that command out of its queue, and it never writes another command for
  that port. The hub keeps running the last power it received. Observed
  byte-for-byte with `npm run trace`, reproduced offline in
  `mac-harness/test/poweredup-queue.test.js`, and fixed by writing motor
  commands directly (`mac-harness/src/rawmotor.js`). The ESP32 firmware
  (Legoino) writes without waiting for acknowledgements and has no such
  queue, so it is not affected. See `docs/OPEN-ISSUE-port-a.md`.
- **The micro:bit froze on the connected checkmark.** The ESP32 was sending
  status as a raw byte, and a raw `0x03` (`CALIBRATING`) is Ctrl-C to the
  MicroPython console that `uart.init(tx=pin0, rx=pin1)` puts on `P1`.
  Status now travels as ASCII digits. See
  `docs/OPEN-ISSUE-microbit-freeze.md`.
- **`uflash` flashes exactly one script.** `main.py` imports `shaping.py`,
  so a plain `uflash main.py` boots into an `ImportError`. `flash.sh` now
  builds a single bundle first. See the flashing section below.
- **Small tilts made the drive motors whine instead of turn.** Geared LEGO
  motors stall below roughly 25% power. `DRIVE_MIN_POWER` in
  `esp32/include/hw_config.h` maps any non-zero throttle onto the 25..100
  band.

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

## Flashing the micro:bit: `uflash` flashes exactly one script

`main.py` does `from shaping import ...`, and `uflash` only ever flashes a
single file, so a plain `uflash main.py` boots into a scrolling
`ImportError`. `microbit/flash.sh` handles this by running
`build_bundle.py`, which inlines `shaping.py`'s source into `main.py` at
flash time and flashes the bundle. `shaping.py` stays the single source of
truth and stays under test; nothing hand-copied is ever flashed.

The other obvious approach, `microfs put shaping.py` onto the device
filesystem as a second file, does not work with this script. `main.py`
calls `uart.init(tx=pin0, rx=pin1)` a few hundred milliseconds into boot,
which moves the micro:bit's only UART (and with it the USB REPL that
`microfs` needs) off USB.

What to expect after a correct flash, with the micro:bit on USB only (not
yet wired to an ESP32): the target icon (`Image.TARGET`, the initial
neutral capture) appears first, then it clears and settles on
`Image.DIAMOND_SMALL`, the icon for status 0, and stays there, because
nothing is connected to `P0`/`P1` to change `status`. `Image.SAD` is only
the fallback for a byte that is not a status digit, which silence cannot
produce.

## Bring-up order

Do every step here with the car on a stand, wheels off the ground, except
the last. The three components are staged so that each stage isolates
exactly one new interface.

1. **Harness drives the car** (no ESP32, no micro:bit). This is the
   hardware-constants work above: `npm run discover`, `npm run calibrate`,
   `npm run drive`. Validates BLE, port discovery, and the calibration
   algorithm using a version of it that has a REPL and real logs in front of
   it. Exit criteria: you can drive the car from the keyboard, and
   `hardware-constants.json` holds real, agreeing numbers.
2. **ESP32 drives the car from hand-typed serial frames** (no micro:bit).
   Build and flash with the measured `hw_config.h`:
   ```bash
   cd esp32
   pio run -e esp32dev -t upload
   pio device monitor
   ```
   Confirm in the monitor: `[ble] connected`, then a calibration sweep that
   sounds and looks like the one the harness just did (span within a few
   degrees of what you measured), then a settle at center. Then type frames
   by hand into the serial monitor's send line (see the checksum section
   below) and confirm the car responds: steering moves proportionally,
   throttle ramps rather than snapping, and stopping input for about 200 ms
   triggers `FAILSAFE`. This validates the BLE half of the firmware and the
   frame parser with no micro:bit involved. A fault here is in `main.cpp`,
   `control.cpp` or `protocol.cpp`, not in the wiring or the micro:bit.
3. **Full stack.** Wire the micro:bit to the ESP32 per the README's wiring
   table, power both boards, and confirm the LED status icon matches what
   the serial monitor says the ESP32's state is. The protocol's byte
   sequence is `BOOT` -> `BLE_SCANNING` -> `CONNECTED` -> `CALIBRATING` ->
   `READY_DISARMED`, but `CONNECTED` is sent once and superseded roughly
   2 ms later by `CALIBRATING`, before the micro:bit's next UART read, so
   it is a real transient state that is not normally rendered. If the
   display does stop on the `CONNECTED` checkmark and never moves again,
   that is the signature of a raw `0x03` reaching the micro:bit's console
   (see `docs/OPEN-ISSUE-microbit-freeze.md`); status must go down the wire
   as ASCII digits (`statusToWire` on the ESP32, `decode_status` on the
   micro:bit). What you should observe on the display is the scanning icon
   (`Image.DIAMOND`), then the calibrating clock (`Image.ALL_CLOCKS[0]`)
   for the several seconds of the sweep, then the disarmed square
   (`Image.SQUARE_SMALL`). Then press button A and confirm the heart
   (`ARMED`) and the wheels responding to tilt. This is the only stage that
   exercises the micro:bit code and the physical wiring together, so it is
   the only stage that can surface a wiring mistake or a micro:bit bug. Do
   it last, and only once stages 1 and 2 both work.
4. **Wheels down, on the ground, only after stage 3 is clean** on the stand.
   Start with the car pointed at open space, away from furniture, feet, or
   a drop.

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
| `0,0,1`       | `31`     | `!0,0,1*31`        | centered, zero throttle, armed. A good first frame to send: it should hold the wheels straight and the drive motors stopped, and (if calibration is done) refresh the failsafe timer without moving anything |
| `0,0,0`       | `30`     | `!0,0,0*30`        | centered, zero throttle, **not armed**     |
| `30,-50,3`    | `18`     | `!30,-50,3*18`     | steer right 30, reverse 50, armed + recal flag set |

A malformed or wrong-checksum frame is dropped silently by the parser and,
deliberately, does **not** refresh the failsafe timer. A mistyped checksum
while testing therefore drifts the car toward `FAILSAFE` rather than doing
anything unexpected.

## What to watch for on first power-up

- **A brownout looks like the micro:bit rebooting.** If the boot icon
  (`Image.DIAMOND_SMALL`) reappears on the micro:bit's display at the exact
  moment the drive motors start drawing current, the ESP32's 3.3 V regulator
  is sagging under the combined load of the radio and a micro:bit riding on
  the same rail. This only applies to the single-supply wiring (`3V` to
  `3V3`); the verified setup powers each board from its own USB port. If you
  see it, power the micro:bit from its own supply and keep only `P0`, `P1`
  and `GND` shared between the two boards. Reducing motor power does not
  address the cause.
- **The steering-calibration ERROR latch.** After 3 consecutive failed
  calibration attempts (each attempt times out after about 3 seconds per
  sweep direction if the motor never stalls), the firmware sets a permanent
  `g_calibLatchedError` flag, stops touching the steering motor, and reports
  status `ERROR` (icon: skull) until the next reconnect. This is
  `MAX_CALIB_ATTEMPTS` in `esp32/src/main.cpp`. The usual cause is a wrong
  `HW_STEER_PORT`: the firmware is sweeping a drive motor or an empty port,
  which never stalls the way a steering motor against its end stops does.
  Reconnecting the hub (power-cycle the car, or otherwise force a BLE
  disconnect and reconnect) resets the attempt counter without reflashing.
  If `ERROR` appears on the first real run, re-check `HW_STEER_PORT`
  against `docs/hardware-map.md` before retrying.

## Hardware finding: both stop commands stop the motor

Measured on the car with a 900 ms settling delay before reading the
encoder:

```
  setPower(0)    running= 585  during-stop=  69  AFTER=   0
  brake()        running= 595  during-stop=  33  AFTER=   0
```

Both `setPower(0)` and `brake()` bring the motor to a full stop. `brake()`
is more abrupt (33 degrees of stopping transient against 69), which is a
reason to prefer it, but either one stops the car.

An earlier measurement concluded that `setPower(0)` only coasts. That
measurement started counting the instant each command was sent, so it
recorded the motor's deceleration as continued rotation, and by the time
`brake()` was called the motor had already spent 1.5 seconds coasting to a
near stop. When timing a physical process, let it settle before judging it.

### What this means for the firmware

The firmware's stop is `brakeMotor()` in `esp32/src/main.cpp`: StartPower
with value 127, the same bytes `brake()` sends from the Mac harness and the
stop that has been measured on the car. It does not use Legoino's
`stopTachoMotor`. That function sends sub-command `0x01` followed by
max-power, brake-style and profile bytes; in LWP3, `0x01` is a one-byte
StartPower, so those trailing bytes are not part of any command and the
hub's response to them is not defined by the spec. `npm run firmwarecmds`
in the harness sends those exact bytes, and on 2026-09-06 the hub tolerated
them: Legoino's sweep bytes (speed byte 37) drove the steering to the same
end stop the validated sweep finds, and Legoino's stop bytes (speed byte
127) brought both drive motors from about 230 degrees per half second to
zero, with no Generic Error from the hub. So this hub reads the first
payload byte of the `0x01` form as StartPower and ignores the rest. The
firmware still does not rely on that: it sends the spec-defined bytes,
pinned by test to the harness's. The calibration sweep likewise uses raw
StartPower at 30, as the harness sweep does, instead of
`setTachoMotorSpeed`.

Every motor command the firmware sends is built by `esp32/lib/ctrl/lwp3.cpp`
and written with Legoino's raw `WriteValue`, not through Legoino's motor
helpers. Those helpers rescale power and speed through `MapSpeed` (0
becomes 127, 1..100 becomes 1..126, -1..-100 becomes 255..128), so
`setBasicMotorSpeed(port, 100)` puts 126 on the wire, a value LWP3 does not
define for StartPower and the car has not been shown to obey.
`test/test_lwp3` pins the firmware's bytes to the same vectors as
`mac-harness/test/rawmotor.test.js`, so what the firmware sends is exactly
what the harness has measured on the car.

## Hardware finding: back-to-back motor commands from the harness

Braking two motors in a tight loop from the Mac harness did not stop the
first one. Bisected on the car (encoder degrees after the stop, first and
second motor):

```
  1. one motor,  one speed,  no steer cmd         0  stopped
  2. TWO motors, one speed,  no steer cmd       536    0  first still turning
  3. TWO motors, TWO speeds, no steer cmd       514    0  first still turning
  4. TWO motors, TWO speeds, WITH steer cmd     532    0  first still turning
```

One motor brakes reliably. With two, the first motor keeps running and only
the second stops. Adding speed changes or steering commands changes
nothing; two consecutive commands is the entire trigger. Spacing only the
stop commands does not help either: two `setPower` calls fired in the same
tick leave that port ignoring every later command, so the stop fails long
afterwards and looks like a broken stop. With the two starting commands
60 ms apart, every stop method worked, including a plain `setPower(0)`.
20 ms was measured as not enough.

The mechanism is not in the hub. It is node-poweredup's per-port command
queue wedging when a second write is issued before the first one's BLE
acknowledgement returns, after which the library silently stops writing to
that port for the rest of the session (`docs/OPEN-ISSUE-port-a.md`). The
harness now bypasses that queue by writing motor commands directly
(`mac-harness/src/rawmotor.js`) and still spaces commands 40 ms apart.
Legoino on the ESP32 writes directly and has no such queue, so this does
not apply to the firmware; its `delay(30)` spacing is kept as insurance,
not as a fix.

Two further notes from that investigation:

- **Do not await node-poweredup's motor methods as a fix.** They return a
  promise that only settles on hub feedback, so on a wedged port
  `await motor.brake()` never returns, with the car still driving. The
  promises from `rawMotor` settle on the BLE write acknowledgement and are
  safe to await.
- **`stopEverything()` sends the whole stop pair twice.** A stop is the one
  command worth repeating. Without it, a failsafe on a wedged port would
  stop one axle and leave the car driving on the other.
