// Shared steering-motor sweep helper used by calibrate.js and drive.js.
// Drive the motor at `power` until it stalls against an end stop.
// Returns the position where it stalled. Always stops the motor.
import { isStalled } from "./steering-math.js";

const TIMEOUT_MS = 3000;

export async function sweep(motor, power, opts = {}) {
  const { timeoutMs = TIMEOUT_MS, portName } = opts;
  const samples = [];
  const onRotate = ({ degrees }) => samples.push({ t: Date.now(), deg: degrees });
  motor.on("rotate", onRotate);
  const t0 = Date.now();
  motor.setPower(power);
  try {
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 25));
      if (isStalled(samples)) {
        return samples[samples.length - 1].deg;
      }
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
