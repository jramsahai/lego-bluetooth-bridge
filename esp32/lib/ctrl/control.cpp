#include "control.h"
#include <math.h>

bool computeSteerRange(int32_t posMin, int32_t posMax, SteerRange *out) {
    if (out == NULL) return false;
    if (posMax <= posMin) return false;
    double center = (double)(posMin + posMax) / 2.0;
    double half = ((double)(posMax - posMin) / 2.0) * 0.9;
    out->center = (int32_t)lround(center);
    out->halfRange = (int32_t)lround(half);
    return true;
}

int32_t steerToPosition(int steer, int32_t halfRange) {
    if (steer > 100) steer = 100;
    if (steer < -100) steer = -100;
    return (int32_t)lround(((double)steer / 100.0) * (double)halfRange);
}

int slewLimit(int current, int target, int maxDelta) {
    int delta = target - current;
    if (delta > maxDelta) delta = maxDelta;
    if (delta < -maxDelta) delta = -maxDelta;
    return current + delta;
}

void stallReset(StallDetector *d, uint32_t windowMs, int32_t thresholdDeg) {
    d->count = 0;
    d->head = 0;
    d->windowMs = windowMs;
    d->thresholdDeg = thresholdDeg;
}

bool stallPush(StallDetector *d, uint32_t nowMs, int32_t deg) {
    d->t[d->head] = nowMs;
    d->deg[d->head] = deg;
    d->head = (d->head + 1) % StallDetector::CAP;
    if (d->count < StallDetector::CAP) d->count++;

    if (d->count < 2) return false;

    // "Have we sampled for a full window yet?" is asked of the OLDEST sample
    // we still hold, not of the window: everything inside the window is by
    // definition younger than windowMs, so asking it there is never true.
    size_t oldestIdx = (d->head + StallDetector::CAP - d->count) % StallDetector::CAP;
    if (nowMs - d->t[oldestIdx] < d->windowMs) return false;

    // Span is measured over the samples inside the window only.
    int32_t lo = deg, hi = deg;
    size_t inWindow = 0;
    for (size_t i = 0; i < d->count; i++) {
        size_t idx = (d->head + StallDetector::CAP - 1 - i) % StallDetector::CAP;
        if (nowMs - d->t[idx] > d->windowMs) break;
        if (d->deg[idx] < lo) lo = d->deg[idx];
        if (d->deg[idx] > hi) hi = d->deg[idx];
        inWindow++;
    }
    if (inWindow < 2) return false;
    return (hi - lo) <= d->thresholdDeg;
}
