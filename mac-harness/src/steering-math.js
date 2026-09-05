// Pure steering geometry. No Bluetooth, no I/O, no timers.
// Task 6 reimplements this in C++ for the ESP32 against the same vectors.

export function isStalled(samples, { windowMs = 150, thresholdDeg = 2 } = {}) {
  if (samples.length < 2) return false;
  const latest = samples[samples.length - 1];
  // "Have we sampled for a full window yet?" must be asked of the WHOLE
  // history, not of the window: every sample inside the window is by
  // definition younger than windowMs, so asking it there is never true.
  if (latest.t - samples[0].t < windowMs) return false;
  const window = samples.filter((s) => latest.t - s.t <= windowMs);
  if (window.length < 2) return false;
  const degs = window.map((s) => s.deg);
  return Math.max(...degs) - Math.min(...degs) <= thresholdDeg;
}

export function computeSteeringRange(posMin, posMax, { marginFraction = 0.1 } = {}) {
  if (posMax <= posMin) {
    throw new Error(`invalid sweep: posMax (${posMax}) must exceed posMin (${posMin})`);
  }
  const center = Math.round((posMin + posMax) / 2);
  const halfRange = Math.round(((posMax - posMin) / 2) * (1 - marginFraction));
  return { center, halfRange };
}

export function steerToPosition(steer, halfRange) {
  const clamped = Math.max(-100, Math.min(100, steer));
  return Math.round((clamped / 100) * halfRange);
}
