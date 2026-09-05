#pragma once
#include <stdint.h>
#include <stddef.h>

// Pure control geometry. Must not include Arduino.h.
// C++ mirror of mac-harness/src/steering-math.js — keep the two in agreement.

struct SteerRange {
    int32_t center;
    int32_t halfRange;
};

// 10% safety margin is applied here, matching the spec.
bool computeSteerRange(int32_t posMin, int32_t posMax, SteerRange *out);

int32_t steerToPosition(int steer, int32_t halfRange);

// Moves `current` at most `maxDelta` toward `target`, without overshooting.
int slewLimit(int current, int target, int maxDelta);

struct StallDetector {
    static const size_t CAP = 16;
    uint32_t t[CAP];
    int32_t deg[CAP];
    size_t count;
    size_t head;
    uint32_t windowMs;
    int32_t thresholdDeg;
};

void stallReset(StallDetector *d, uint32_t windowMs, int32_t thresholdDeg);

// Feed one position sample. Returns true once a full `windowMs` of history
// has been observed and the whole window spans <= thresholdDeg.
bool stallPush(StallDetector *d, uint32_t nowMs, int32_t deg);
