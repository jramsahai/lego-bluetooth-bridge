# Port A stops accepting motor commands — RESOLVED

**Status:** root cause identified, observed byte-for-byte on the car, fixed in
the Mac harness, fix confirmed on the car (2026-09-05).
**Firmware:** the mechanism is specific to the Mac's Bluetooth stack and
node-poweredup. It cannot occur in the ESP32 firmware, which writes without
waiting for acknowledgements and has no command queue.

---

## Root cause

Port A never ignored a command. **The commands were never written to
Bluetooth.** Two layers of the Mac stack combine to do this:

1. **`@stoprocent/noble` drops a pending write callback when another write
   is issued.** `Characteristic.write()` registers its completion callback
   with `onceExclusive('write', ...)`, which *removes the previous pending
   listener* for the same event. Every port on the hub shares one
   characteristic. So if a write for port B is issued before the write for
   port A has been acknowledged, A's callback is gone: A's write promise
   never resolves. (The bytes for A still went out and the hub executed them;
   only the acknowledgement is lost.) On this Mac a write acknowledgement takes
   **49–64 ms**.

2. **node-poweredup 10.x only moves a command out of its per-port queue when
   the write promise resolves** (`dist/devices/device.js`,
   `transmitNextPortOutputCommand`: the command is shifted from
   `_nextPortOutputCommands` inside `send(...).then(...)`). With A's promise
   never resolving, A's first command sits at the head of A's queue in
   `TRANSMISSION_BUSY` forever. The queue never sends past a busy head, and a
   `brake()` (interrupt) deliberately keeps busy commands. Every later
   `setPower()` and `brake()` for port A is queued behind it, its promise
   never settles, and **nothing is ever written to Bluetooth for that port
   again** until the process restarts. Port B has its own queue and is
   untouched.

The hub, meanwhile, keeps doing what it was last told.

### Why the threshold was between 40 and 60 ms

The write acknowledgement round trip is ~50–65 ms. A second command to the
hub issued 60 ms after the first almost always lands after the first's
acknowledgement, so nothing is dropped. Issued 0–40 ms after, it lands before
and drops it. That is the whole table:

| Test | gap between A and B commands | port A afterwards |
|------|------------------------------|-------------------|
| `exacttest` rows 2-4 | 0 ms | BROKEN |
| `drive.js` | 40 ms | BROKEN |
| `pairtest` | 60 ms | healthy |

It is a timing race, so A alone could never fail, and any synthetic test that
happened to space its writes wider than the round trip passed.

### Why it looked like "full speed regardless of power"

```
  2. A + B, no calibration           slow= 360 fast=1054 ratio=2.93  second command WORKED
  3. A alone, AFTER calibration      slow=1013 fast=1014 ratio=1.00  <<<< IGNORED
```

Row 3's "power 30" ran at 1013 — the same as row 2's **power 70**. Port A was
not at full speed; it was still running row 2's power-70 command. In that run
the acknowledgement dropped was the one for row 2's `A.setPower(70)` (B's
`setPower(70)` followed it 40 ms later). That command itself executed — a
dropped acknowledgement does not stop the bytes going out — but from then on
A's queue was wedged, so row 2's `A.brake()` and every A command in rows 3 and
4 were queued and never written.

In the traced run below the dice fell differently and the wedge hit one pair
earlier, at the two-motor `setPower(30)`: A ran at power 30 for the rest of the
run (374, 353, 361 degrees per second) and neither the `setPower(70)` nor the
`brake()` was written. Same mechanism, different first casualty — which is what
a timing race looks like.

### Why the earlier hypotheses were all eliminated correctly

Nothing was hub-side or mechanical. Stop commands work (they were never sent).
The process was alive (it was, just queueing). The calibration was innocent
(it happened to follow the two-motor run). Awaiting the library call hung (the
promise waits on an acknowledgement noble has discarded).

## Evidence

### 1. Raw BLE trace on the car (`npm run trace`, 2026-09-05)

Context 2 (A then B, 40 ms apart), abridged:

```
11832ms TX  81 00 01 51 00 1e  port=0 value=30   queue[A] next=1
11874ms TX  81 01 01 51 00 1e  port=1 value=30   queue[B] next=1
11885ms  ack write 81 01 01 51 00 1e after 11ms      <- ONE ack for two writes; 53 ms after A's
13876ms APP A.command 51 00 46                      queue[A] next=1   <- A.setPower(70): no TX follows
13918ms TX  81 01 01 51 00 46  port=1 value=70
15920ms APP A.command 51 00 7f interrupt=true        queue[A] next=2   <- A.brake(): no TX follows
15962ms TX  81 01 11 51 00 7f  port=1 value=127
18165ms 2. A + B: slow=374 fast=353 afterBrake=361   <<<< PORT A NOT FOLLOWING COMMANDS

===== DID EACH COMMAND REACH BLUETOOTH? =====
  1. A alone: A.setPower(30)            written, acked 52ms later
  1. A alone: A.setPower(70)            written, acked 59ms later
  1. A alone: A.brake()                 written, acked 64ms later
  2. A + B:   A.setPower(30)            written, acked NEVER
  2. A + B:   B.setPower(30)            written, acked 11ms later
  2. A + B:   A.setPower(70)            <<<< NEVER WRITTEN TO BLE
  2. A + B:   B.setPower(70)            written, acked 37ms later
  2. A + B:   A.brake()                 <<<< NEVER WRITTEN TO BLE
  2. A + B:   B.brake()                 written, acked 63ms later
  final queue[A] bufLen=0 transmitted=0 next=2
```

The one acknowledgement at 11885 ms is A's (53 ms after A's write, 11 ms after
B's), delivered to B's callback because A's had been removed. The raw brakes at
the end of the run, which bypass the queue, stopped port A immediately.

### 2. Offline reproduction, no hardware

`mac-harness/test/poweredup-queue.test.js` drives the real
`TechnicLargeLinearMotor` class from node-poweredup 10.1.0 with a fake hub. The
first test issues A then B, discards A's write acknowledgement the way noble
does, and shows every later A command is never written while B keeps working.
`npm test` runs it.

### 3. The fix, on the car (`RAW=1 npm run secondcmd`, 2026-09-05)

```
  motor path: RAW writes (bypassing the library queue)
  1. A alone, no calibration         slow= 377 fast=1016 ratio=2.69  second command WORKED
  2. A + B, no calibration           slow= 361 fast= 999 ratio=2.77  second command WORKED
  running the steering calibration... done.
  3. A alone, AFTER calibration      slow= 358 fast= 958 ratio=2.68  second command WORKED
  4. A + B, AFTER calibration        slow= 357 fast= 991 ratio=2.78  second command WORKED
```

Rows 3 and 4 had failed on every previous run of this test.

## The fix

`mac-harness/src/rawmotor.js` wraps a node-poweredup device and writes each
port output command directly with `hub.send`, bypassing the library queue
entirely. The bytes are the ones Legoino sends from the ESP32
(`setBasicMotorSpeed`, `setAbsoluteMotorPosition`,
`setAbsoluteMotorEncoderPosition`), so the harness now exercises the same wire
pattern as the firmware. Position notifications still come from the library
device. Its promises settle on the acknowledgement or a 300 ms timeout,
whichever is first, so awaiting them can never hang even when an
acknowledgement is dropped. `drive.js`, `calibrate.js` and `selftest.js` use
it.

The 40 ms spacing in `drive.js` and `delay(30)` in the firmware are no longer
load-bearing. They are kept because they are cheap.

A full interactive drive through the fixed path (repeated speed changes,
reversals and stops on both drive motors, commanded 40 ms apart) completed
with every command taking effect and every stop verified. `drive.js`
calibrates the steering on every start again; `SKIP_CALIB=1` reuses the
recorded range.

## What this means for the ESP32 firmware

Legoino's `WriteValue` builds the header and calls
`writeValue(data, len, /*response=*/false)` immediately: no acknowledgement is
awaited, there is no callback to drop, there is no queue, and `parsePortAction`
(the 0x82 handler) is an empty stub. Neither half of the mechanism exists
there. The firmware's motor path is **not** implicated by this issue, and the
earlier inference that "the same fault would likely affect the firmware" is
withdrawn. The firmware remains unverified on hardware for every other reason
listed in `docs/BRINGUP.md`.

## Upstream

Two bugs, neither in this repo:

- **node-poweredup**: a command should not stay at the head of the queue
  forever because a write promise never settled. Move it to
  `_transmittedPortOutputCommands` when the write is issued, or time it out.
  Report to <https://github.com/nathankellenicki/node-poweredup/issues> with
  `test/poweredup-queue.test.js` as the reproduction.
- **@stoprocent/noble**: `Characteristic.write()` with a callback uses
  `onceExclusive`, so two overlapping writes on one characteristic lose the
  first callback. Writes should be queued per characteristic or the callbacks
  matched to responses.

## Reproduction and diagnostic scripts

All under `mac-harness/`, run with `npm run <name>`:

| Script | Purpose |
|--------|---------|
| `trace` | **Raw BLE trace of the failing sequence; says whether each command was ever written** |
| `secondcmd` | Whether port A accepts a second command, in four contexts (`RAW=1` = through the fix) |
| `discover` | List what is attached to each hub port |
| `calibrate` | Sweep the steering to its end stops and measure the range |
| `drive` | The interactive driving script where the fault appeared |
| `selftest` | Scripted direction check, no keyboard needed |
| `motortest` | Each drive motor alone, with rotation logging (`BOTH=1` for both) |
| `stoptest` | Ranks stop commands, with a settling delay |
| `floodtest` | Whether a burst of rapid commands breaks later ones |
| `reprotest` | Brake under progressively more of drive.js's context |
| `exacttest` | Bisects drive.js's exact command sequence |
| `pairtest` | Six ways of stopping two running motors |
| `calibbisect` | Steps through the calibration, re-checking port A after each |
| `steerb` | Whether port B's activity during steering breaks port A |

The diagnostic scripts other than `secondcmd` still go through the library
queue on purpose: they are the record of how the fault presented.

## Methodological notes, kept from the original write-up

Three mistakes cost significant time; they are worth not repeating.

1. **Measuring a physical process without letting it settle.** The original
   `stoptest` counted deceleration as motion and produced a confident, wrong
   conclusion that then propagated into the docs and a firmware change.
2. **Reading two consecutive failures as two data points** when port A stays
   broken once broken, so the second was contaminated by the first.
3. **Reasoning toward a mechanism instead of bisecting toward one.** The
   bisection is what narrowed this to "A and B commanded close together".

And two from this round. **The last hop was never read**: every hypothesis
assumed the library wrote what it was asked to write; two hundred lines of
`device.js` and twenty of noble's event emitter held the answer. And **the
first offline reproduction was of the right layer but the wrong trigger**
(feedback ordering, not a dropped acknowledgement); the BLE trace on the car
corrected it in one run. Instrument the boundary, then theorise.
