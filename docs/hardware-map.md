# Hardware map — LEGO 42160 (Technic Hub 88012)

Recorded: 2026-09-05, from `npm run discover`. Battery: 100%.

## Discovered ports

| Port | LWP3 number | type | class | Role |
|------|-------------|------|-------|------|
| A    | 0 | 46 | TechnicLargeLinearMotor | motor — role TBD by sweep |
| B    | 1 | 46 | TechnicLargeLinearMotor | motor — role TBD by sweep |
| C    | 2 | —  | (nothing attached)      | unused |
| D    | 3 | 46 | TechnicLargeLinearMotor | motor — role TBD by sweep |

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

## Roles — pending

Steering port: UNKNOWN (run the sweep)
Drive ports: UNKNOWN (the two that are not steering)
Measured steering span: UNKNOWN
steerHalfRange: UNKNOWN
