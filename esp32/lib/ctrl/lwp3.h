#pragma once
#include <stdint.h>
#include <stddef.h>

// LEGO Wireless Protocol 3.0 Port Output Commands, built byte by byte so the
// firmware sends exactly what mac-harness/src/rawmotor.js sends, which is what
// has been measured on the car. Pure logic; must not include Arduino.h.
// Legoino's own motor helpers are NOT used for output: they rescale power and
// speed through MapSpeed (0 -> 127, 1..100 -> 1..126, -1..-100 -> 255..128),
// putting values on the wire that LWP3 does not define and the car has never
// been shown to obey. Every builder emits {0x81, port, 0x11, ...}: Port
// Output Command, execute immediately, request feedback.

static const int     LWP3_POWER_BRAKE       = 127;   // StartPower value meaning brake
static const uint8_t LWP3_BRAKE_STYLE_BRAKE = 127;   // end-state for GotoAbsolutePosition
static const uint8_t LWP3_PROFILE_ACC_DEC   = 0x03;  // use acceleration + deceleration profiles

// StartPower via WriteDirectModeData mode 0. `power` is clamped to -100..100
// unless it is exactly LWP3_POWER_BRAKE. Fills 6 bytes, returns 6.
size_t lwp3StartPower(uint8_t port, int power, uint8_t out[6]);

// GotoAbsolutePosition. `speed` is clamped to -100..100 and sent unscaled.
// Fills 12 bytes, returns 12.
size_t lwp3GotoAbsolute(uint8_t port, int32_t position, int speed, uint8_t maxPower, uint8_t brakeStyle, uint8_t out[12]);

// PresetEncoder via WriteDirectModeData mode 2: the current position becomes
// `position`. Fills 9 bytes, returns 9.
size_t lwp3PresetEncoder(uint8_t port, int32_t position, uint8_t out[9]);
