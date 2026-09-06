// Shared steering-motor sweep helper used by calibrate.js and drive.js.
// Drive the motor at `power` until it stalls against an end stop.
// Returns the position where it stalled. Always stops the motor.
import { isStalled } from "./steering-math.js";

const TIMEOUT_MS = 3000;
const POLL_MS = 25;
// Ignore stall verdicts for this long after commanding power. BLE write
// latency plus motor spin-up means the motor is still stationary for the
// first ~130ms, which otherwise reads as an end stop before it has moved.
// Mirrors the same dead time in the ESP32 firmware.
const DEAD_TIME_MS = 300;
// How long to wait for the subscription's first position reading before
// commanding power, so we always have a baseline to sample.
const BASELINE_MS = 750;

export async function sweep(motor, power, opts = {}) {
  const {
    timeoutMs = TIMEOUT_MS,
    pollMs = POLL_MS,
    deadTimeMs = DEAD_TIME_MS,
    baselineMs = BASELINE_MS,
    portName,
  } = opts;

  // "rotate" is a CHANGE notification: when the motor stalls against a stop,
  // its position stops changing and the events stop entirely. Sampling the
  // events directly can therefore never observe stillness — the absence of
  // motion is the absence of data. So cache the last reading and sample it
  // on a fixed interval instead, which is what the ESP32 firmware does.
  let lastDeg = null;
  const onRotate = ({ degrees }) => { lastDeg = degrees; };
  motor.on("rotate", onRotate);

  try {
    // Establish a baseline before moving, so a motor that is ALREADY resting
    // against its stop (and will therefore emit nothing at all) still has a
    // position we can sample and report.
    const bStart = Date.now();
    while (lastDeg === null && Date.now() - bStart < baselineMs) {
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const samples = [];
    const t0 = Date.now();
    motor.setPower(power);

    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (lastDeg === null) continue;              // still no reading at all
      samples.push({ t: Date.now(), deg: lastDeg });
      if (Date.now() - t0 < deadTimeMs) continue;  // spin-up dead time
      if (isStalled(samples)) return lastDeg;
    }

    throw new Error(
      `sweep at power ${power} never stalled within ${timeoutMs}ms — ` +
      `is port ${portName ?? "?"} really the steering motor? A drive motor spins forever.`
    );
  } finally {
    motor.brake();
    motor.removeListener("rotate", onRotate);
    await new Promise((r) => setTimeout(r, 300)); // settle before reversing
  }
}
