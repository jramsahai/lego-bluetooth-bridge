#pragma once
#include <stdint.h>

// ============================================================================
// UNVERIFIED PLACEHOLDER VALUES.
//
// These constants are transcribed from mac-harness/hardware-constants.json,
// which itself carries "verified": false. No physical car was available when
// this file was written. Before this firmware is trusted to drive the real
// LEGO Technic 42160 / Technic Hub 88012:
//   1. Run `npm run discover`, then `npm run calibrate`, then `npm run drive`
//      in mac-harness/ against the real car.
//   2. Confirm drive-motor agreement and steering direction.
//   3. Re-measure steerHalfRange from two agreeing calibration runs.
//   4. Update mac-harness/hardware-constants.json (set "verified": true) and
//      transcribe the confirmed values into this file by hand.
// Until that has happened, HW_STEER_PORT, HW_DRIVE_PORTS, HW_DRIVE_INVERT,
// and HW_STEER_INVERT below are best-guess placeholders only.
// ============================================================================

// Transcribed from mac-harness/hardware-constants.json (Task 4).
// Port letters map to LWP3 port numbers: A=0, B=1, C=2, D=3.
static const uint8_t HW_STEER_PORT = 0;              // "A"
static const uint8_t HW_DRIVE_PORTS[2] = { 1, 2 };   // "B", "C"
static const bool HW_DRIVE_INVERT[2] = { false, true };
static const bool HW_STEER_INVERT = false;

// UART to the micro:bit. GPIO16/17 are free on WROOM; see the spec if you
// substitute a WROVER, where PSRAM claims them.
static const int PIN_UART_RX = 16;   // <- micro:bit P0
static const int PIN_UART_TX = 17;   // -> micro:bit P1
static const uint32_t UART_BAUD = 115200;

// Calibration (spec values).
static const int SWEEP_SPEED = 30;
static const uint8_t SWEEP_MAX_POWER = 50;
static const uint32_t SWEEP_TIMEOUT_MS = 3000;
static const uint32_t STALL_WINDOW_MS = 150;
static const int32_t STALL_THRESHOLD_DEG = 2;

// Driving.
static const int STEER_SPEED = 100;
static const uint8_t STEER_MAX_POWER = 100;
static const int THROTTLE_SLEW_PER_TICK = 4;   // per 20 ms tick

// Failsafe and status.
static const uint32_t FRAME_TIMEOUT_MS = 200;
static const uint32_t STATUS_PERIOD_MS = 200;  // 5 Hz
static const uint32_t CONTROL_PERIOD_MS = 20;  // 50 Hz
