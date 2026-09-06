import { PoweredUP } from "node-poweredup";
import { computeSteeringRange, steerToPosition } from "./steering-math.js";
import { sweep } from "./sweep.js";

const STEER_PORT = process.env.STEER_PORT || "A";
const DRIVE_PORTS = (process.env.DRIVE_PORTS || "B,C").split(",");
const INVERT = (process.env.DRIVE_INVERT || "false,false").split(",").map((s) => s === "true");
const SWEEP_POWER = 30;
const TIMEOUT_MS = 3000;

const poweredUP = new PoweredUP();

poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const steer = await hub.waitForDeviceAtPort(STEER_PORT);
  const drives = [];
  for (const p of DRIVE_PORTS) drives.push(await hub.waitForDeviceAtPort(p));

  const stopA = await sweep(steer, SWEEP_POWER, { timeoutMs: TIMEOUT_MS, portName: STEER_PORT });
  const stopB = await sweep(steer, -SWEEP_POWER, { timeoutMs: TIMEOUT_MS, portName: STEER_PORT });
  const { center, halfRange } = computeSteeringRange(
    Math.min(stopA, stopB), Math.max(stopA, stopB)
  );
  await steer.gotoAngle(center, 40);
  await hub.sleep(600);
  await steer.resetZero();
  console.log(`Calibrated. halfRange=${halfRange}`);

  let throttle = 0;
  let steerValue = 0;

  const apply = () => {
    for (let i = 0; i < drives.length; i++) {
      drives[i].setPower(INVERT[i] ? -throttle : throttle);
    }
    steer.gotoAngle(steerToPosition(steerValue, halfRange), 100);
  };

  console.log(
    "\nControls:  A/D steer   W/S throttle   SPACE stop   Q quit\n" +
    "The car must be ON A STAND."
  );

  if (!process.stdin.isTTY) {
    console.error(
      "\nThis script needs a real terminal for keyboard input (stdin is not a TTY).\n" +
      "Run it from your own terminal, or use `npm run selftest` for a scripted,\n" +
      "no-keyboard version that answers the same questions.\n"
    );
    for (const d of drives) d.brake();
    process.exit(1);
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (key) => {
    const k = key.toLowerCase();
    const isCtrlC = key.charCodeAt(0) === 3;
    if (k === "q" || isCtrlC) {
      for (const d of drives) d.brake();
      await steer.gotoAngle(0, 40);
      process.exit(0);
    }
    switch (k) {
      case "a": steerValue = Math.max(-100, steerValue - 20); break;
      case "d": steerValue = Math.min(100, steerValue + 20); break;
      case "w": throttle = Math.min(100, throttle + 10); break;
      case "s": throttle = Math.max(-100, throttle - 10); break;
      case " ": throttle = 0; steerValue = 0; break;
      default: return;
    }
    apply();
    process.stdout.write(`\r steer=${steerValue}  throttle=${throttle}      `);
  });
});

poweredUP.scan();
