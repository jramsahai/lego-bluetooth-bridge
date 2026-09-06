# Open issue: port A stops accepting motor commands

**Status:** unresolved. Worked around in `mac-harness/src/drive.js`, NOT fixed.
**Risk:** the same fault would likely affect the ESP32 firmware, which cannot
apply the same workaround. Resolve before trusting the firmware on the floor.

---

## The symptom

Running `npm run drive` (the interactive Mac driving script), port A ignores
its commanded power. It spins up on the first command and then never changes
again: not to a different speed, not to reverse, not to a brake. Port B, given
identical treatment in the same loop, behaves perfectly - speeds up, slows,
reverses, stops.

Once port A is in this state it stays there for the rest of the hub power
session. Power-cycling the hub clears it.

Measured with the motor's own rotation encoder, so this is not a
misobservation: after `brake()`, port A reports ~500 degrees of rotation per
1.2 s measured 900 ms after the command, i.e. still running at speed.

Critically, when broken, port A runs at **full speed regardless of the power
commanded**. Commanded power 30 produces the same rotation as commanded power
70 (see "Smoking gun" below). So the first command is already being ignored -
it is not that later commands are lost.

## Hardware

- LEGO Technic 42160 Audi RS Q e-tron, **completely stock**, Technic Hub 88012.
- Three `TechnicLargeLinearMotor`s: **A** = rear drive, **B** = front drive,
  **D** = steering (has end stops). Port C empty. Battery 100%.
- Host: macOS, Node v25.9.0, `node-poweredup` over the Mac's built-in Bluetooth.
- The car drives correctly from the official LEGO CONTROL+ app, so the hardware
  is sound.

## Smoking gun measurement

`npm run secondcmd` - port A commanded power 30, then power 70, measuring
actual rotation at each:

```
  1. A alone, no calibration         slow= 378 fast=1064 ratio=2.81  second command WORKED
  2. A + B, no calibration           slow= 360 fast=1054 ratio=2.93  second command WORKED
  running the steering calibration...
  3. A alone, AFTER calibration      slow=1013 fast=1014 ratio=1.00  <<<< IGNORED
  4. A + B, AFTER calibration        slow=1005 fast= 995 ratio=0.99  <<<< IGNORED
```

Note `slow=1013` in row 3: commanded power 30, running at the same rate as
power 70. Pinned at full speed.

## What is confirmed working (do not re-litigate)

- **Both stop commands work.** `setPower(0)` and `brake()` each fully stop the
  motor when measured with a settling delay. An earlier claim in this repo that
  "power 0 coasts, brake stops" was a **measurement artefact** - the test
  measured from the instant the command was sent and counted the deceleration
  transient as continued motion. Corrected in `docs/BRINGUP.md`.
- **The axles are mechanically independent.** Verified by hand: spinning a
  front wheel does not turn the rear. (Rear wheels counter-rotate when turned
  by hand - that is a normal open differential, not a fault.)
- **Port A is not faulty.** It behaves perfectly in isolation and in several
  multi-motor tests.
- **The process is alive when it happens.** The HUD keeps updating and commands
  keep being logged; this is not a crash or an unhandled rejection.

## Hypotheses tried and ELIMINATED

| # | Hypothesis | How it was killed |
|---|-----------|-------------------|
| 1 | Wrong stop command (`setPower(0)` vs `brake()`) | `npm run stoptest` with a settling delay: both give AFTER=0. Both work. |
| 2 | The script crashed, leaving motors running | HUD kept updating; commands kept logging. Process alive. |
| 3 | Two motors braked back-to-back race, one dropped | Spacing the brakes 20 ms apart did not help (`exacttest` row 5). |
| 4 | Fix it by `await`ing the library calls | **Do not do this.** node-poweredup's motor promises never settle; `await motor.brake()` deadlocks the script with the car still driving. It hung a test mid-run. |
| 5 | The axles are mechanically coupled, B back-drives A | Disproven by hand - spinning the front wheel does not move the rear. |
| 6 | The steering calibration breaks it | `npm run calibbisect` steps through the calibration (sweep, sweep, `gotoAngle`, `resetZero`) re-checking port A after each. **All steps healthy.** |
| 7 | Port B *running* during the steering sweep breaks A | `MODE=1 npm run steerb`: healthy before and after. |
| 8 | Port B merely *acquired and subscribed* + full calibration | `npm run calibbisect` with port B acquired: **all steps still healthy.** |

## The unexplained gap

The real script fails. Every synthetic reproduction of it passes. The
difference between the two closest tests:

- **`secondcmdtest` (BREAKS port A):** runs A alone, then runs **A and B
  simultaneously**, then calibrates, then re-checks A.
- **`calibbisect` (port A stays healthy):** never powers port B at all. A is
  always run alone.

**So the one combination never cleanly isolated is A and B running
SIMULTANEOUSLY.** That also matches `exacttest`, where every failing row had
two motors powered together and the single-motor row passed.

## STRONGEST REMAINING LEAD: the gap between simultaneous commands

Two tests powered both motors together and disagree, and they differ only in
the delay between the two `setPower` calls:

| Test | gap between A and B commands | port A afterwards |
|------|------------------------------|-------------------|
| `exacttest` rows 2-4 | **0 ms** (tight loop) | BROKEN |
| `drive.js` (current) | **40 ms** | BROKEN |
| `pairtest` | **60 ms** | healthy - every stop method worked |

That suggests a **threshold somewhere between 40 ms and 60 ms**, below which
issuing commands to two motors corrupts the state of the first one.

### Recommended next experiment

Sweep the gap: power A and B together with a gap of 0, 10, 20, 40, 60, 80,
100 ms, and after each, check whether port A still honours a power change
(command 30, measure, command 70, measure, expect ratio > 1.4). Power-cycle
the hub between trials, because **once port A breaks it stays broken** - this
is why several earlier runs showed two consecutive failures that were really
one failure plus a contaminated follow-up.

If a threshold exists, the fix is to enforce that gap everywhere, including in
the ESP32 firmware (currently `delay(30)`, which by this theory is too small).

If no threshold exists, the next step is to stop writing synthetic tests and
capture the actual BLE traffic - either by instrumenting node-poweredup's
write path to log the raw bytes of every port output command, or with a BLE
sniffer. The question to answer is whether the hub receives a malformed or
mis-targeted command, or receives a correct one and ignores it.

## Why this matters beyond the harness

`mac-harness/src/drive.js` now **skips the steering calibration by default**
(commit 703d2b5) and reuses the already-measured `steerHalfRange` of 105. That
is a workaround, not a fix, and it is labelled as such in the code.

**The ESP32 firmware cannot do this.** `esp32/src/main.cpp` calibrates the
steering on every connect by design - it deliberately never trusts a stale
steering zero, because the wheels may have been moved by hand while
disconnected. It then issues `setBasicMotorSpeed` to both drive ports and
`setAbsoluteMotorPosition` to the steering port on a 50 Hz control tick.

If this fault reproduces there, the car drives with one dead axle, and the
200 ms failsafe cannot stop that axle. That is the failure mode the whole
two-key arming and failsafe design exists to prevent.

**The firmware has never been compiled or run.** There is no ESP32 board in
this environment and Legoino was never downloaded, so none of this has been
observed on the firmware - it is inference from shared behaviour, and should
be verified on hardware rather than assumed in either direction.

## Reproduction scripts

All under `mac-harness/`, run with `npm run <name>`:

| Script | Purpose |
|--------|---------|
| `discover` | List what is attached to each hub port |
| `calibrate` | Sweep the steering to its end stops and measure the range |
| `drive` | The interactive driving script where the fault appears |
| `selftest` | Scripted direction check, no keyboard needed |
| `motortest` | Each drive motor alone, with rotation logging (`BOTH=1` for both) |
| `stoptest` | Ranks stop commands, with a settling delay |
| `floodtest` | Whether a burst of rapid commands breaks later ones |
| `reprotest` | Brake under progressively more of drive.js's context |
| `exacttest` | Bisects drive.js's exact command sequence |
| `pairtest` | Six ways of stopping two running motors |
| `secondcmd` | Whether port A accepts a second command, in four contexts |
| `calibbisect` | Steps through the calibration, re-checking port A after each |
| `steerb` | Whether port B's activity during steering breaks port A |

## Methodological notes for whoever picks this up

Three mistakes cost significant time here; they are worth not repeating.

1. **Measuring a physical process without letting it settle.** The original
   `stoptest` counted deceleration as motion and produced a confident, wrong
   conclusion that then propagated into the docs and a firmware change.
2. **Reading two consecutive failures as two data points** when port A stays
   broken once broken, so the second was contaminated by the first.
3. **Reasoning toward a mechanism instead of bisecting toward one.** Every
   theory that came from reading the code was wrong. The progress all came
   from comparing a script that fails against a script that does not, and
   removing differences one at a time.

A fourth, from the human working on the car: the observation that port B's
wheels never turned during `calibbisect` is what first narrowed this to port
B's involvement. Physical observation of the machine beat every log.
