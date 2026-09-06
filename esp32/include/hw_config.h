#pragma once
#include <stdint.h>

// ============================================================================
// PORT ASSIGNMENTS: MEASURED against the real car on 2026-09-05.
// MOTOR DIRECTIONS: STILL UNVERIFIED — see below.
//
// Measured with mac-harness against a real LEGO Technic 42160 / Hub 88012:
//   - Three TechnicLargeLinearMotors on ports A, B and D. Port C is empty.
//   - D is the steering motor, proven by end-stop sweep. A and B spin freely
//     and are therefore the drive pair.
//   - Steering span measured twice: 234 and 235 degrees (agreement within 1
//     degree), giving a halfRange of 105-106 after the 10% margin. The
//     firmware re-measures this itself on every connect, so it is recorded in
//     mac-harness/hardware-constants.json for reference rather than hardcoded.
//
// STILL UNVERIFIED: HW_DRIVE_INVERT and HW_STEER_INVERT below. Determining
// them needs `npm run drive` against the car — press W and check both drive
// wheels turn the SAME way, then press A and check the car steers LEFT.
// Until that is done these two lines are guesses.
// ============================================================================

static const uint8_t HW_STEER_PORT = 3;              // "D" — measured
static const uint8_t HW_DRIVE_PORTS[2] = { 0, 1 };   // "A", "B" — measured
static const bool HW_DRIVE_INVERT[2] = { false, false };  // UNVERIFIED
static const bool HW_STEER_INVERT = false;                // UNVERIFIED

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
