#pragma once
#include <stdint.h>
#include <stddef.h>

// Wire frame: !<steer>,<throttle>,<flags>*<XX>
// Pure logic only. Must not include Arduino.h — the native test env builds this.

static const uint8_t FLAG_ARMED = 0x01;
static const uint8_t FLAG_RECAL = 0x02;

struct Frame {
    int steer;      // -100..100
    int throttle;   // -100..100
    uint8_t flags;
};

uint8_t xorChecksum(const char *body, size_t len);

// Returns true only for a well-formed, correctly-checksummed, in-range frame.
// On false, *out is left untouched so a caller can keep the last good value.
bool parseFrame(const char *line, Frame *out);
