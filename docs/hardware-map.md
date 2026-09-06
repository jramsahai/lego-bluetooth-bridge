# Hardware map — LEGO 42160 (Technic Hub 88012)

Recorded: 2026-09-05, from `npm run discover`. Battery: 100%.

## Discovered ports

| Port | LWP3 number | type | class | Role |
|------|-------------|------|-------|------|
| A    | 0 | 46 | TechnicLargeLinearMotor | **drive** (never stalled) |
| B    | 1 | 46 | TechnicLargeLinearMotor | **drive** (never stalled) |
| C    | 2 | —  | (nothing attached)      | unused |
| D    | 3 | 46 | TechnicLargeLinearMotor | **steering** (hits end stops) |

Non-port devices also reported, all internal to the hub and not used by this
project: HUB_LED (23), CURRENT_SENSOR (21), VOLTAGE_SENSOR (20), ACCELEROMETER
(57), GYRO_SENSOR (58), TILT_SENSOR (59), plus three unnamed internal devices
(type 60 x2, type 54).

## What this already tells us

- **Three motors, on A, B and D. Port C is empty.** The placeholder values that
  were carried in `esp32/include/hw_config.h` and
  `mac-harness/hardware-constants.json` assumed drive motors on B and C. That is
  wrong and must be corrected once the sweep identifies roles.
- **All three motors report the same device type (46).** Discovery alone cannot
  distinguish steering from drive. Only the steering motor has mechanical end
  stops, so `npm run calibrate` is what proves which port it is: the steering
  motor stalls within ~3 s, a drive motor spins forever and the script times out
  and says so.

## Roles — CONFIRMED 2026-09-05

Steering port: **D** (LWP3 port 3)
Drive ports: **A and B** (LWP3 ports 0 and 1)

Proven by end-stop sweep: A and B both ran the full 3000 ms timeout without
stalling (a drive motor spins forever), while D drove to a hard stop each way.

### Steering measurement

Two consecutive calibration runs:

| Run | stop 1 | stop 2 | span | halfRange |
|-----|--------|--------|------|-----------|
| 1   | 230    | -4     | 234  | 105 |
| 2   | 116    | -119   | 235  | 106 |

The two spans agree within 1 degree, so the 2-degree / 150 ms stall threshold
is correct for this car and does not need loosening. Run 2's centre came back
at -1, meaning run 1's zeroing at centre was accurate to a single degree.

`steerHalfRange` is recorded as **105** (the conservative value). Note the ESP32
firmware re-measures this itself on every connect, so the number is reference
only and is not compiled into the firmware.

## Motor directions — CONFIRMED 2026-09-05

Scripted selftest (`npm run selftest`) against the car:

- Commanded both drive motors forward: **both axles turned the same direction**,
  so `driveInvert` is `[false, false]` — neither motor needs inverting.
- Commanded steer -100: **front wheels pointed left**. Commanded +100: right.
  So `steerInvert` is `false`.

## Axle assignment

- **Port A drives the REAR wheels.**
- **Port B drives the FRONT wheels.**
- Port D steers.

## Resolved: front-left wheel binding (mechanical, not electrical)

During the selftest the front wheels appeared to stop while the rear kept
running. Running both drive motors together with per-motor logging showed both
motors turning continuously and at almost identical rates for the full 6
seconds:

```
TOTALS: A=3125 deg (122 events)  B=3010 deg (121 events)
```

So the front motor never stalled or cut out. Observation on the car: the front
LEFT wheel was not spinning while the front RIGHT was. That is a differential
working as designed — hold one wheel and it routes all the torque to the other.

**Conclusion: the front-left wheel is binding mechanically** (a rubbing tire or
a pinched hub), and the differential is faithfully sending the drive to the free
side. Nothing in the firmware or harness is implicated.

Worth fixing before serious driving, since the car will be down on traction and
will scrub that tire, but it does not block any of the software.

Checks: spin the front-left by hand with power off; look for the tire fouling
bodywork or a suspension arm; confirm the hub is not pinched against the
upright; and confirm the steering really is centred, since the calibration
centres on the midpoint of the motor's travel, which is only true straight-ahead
if the linkage is symmetric.

## Diagnostics available

- `npm run discover` — list what is on each port
- `npm run calibrate` — measure the steering end stops
- `npm run selftest` — scripted direction check, no keyboard needed
- `npm run motortest` — each drive motor alone, with rotation logging
- `BOTH=1 npm run motortest` — both drive motors together, logged separately
- `npm run drive` — interactive keyboard driving (needs a real TTY)
