// Interactive keyboard driving. Needs a real TTY - run it from a terminal.
//
// Defaults are the values measured against the real car (see
// docs/hardware-map.md); override with env vars if the build changes.
import { PoweredUP } from "node-poweredup";
import { computeSteeringRange, steerToPosition } from "./steering-math.js";
import { sweep } from "./sweep.js";

const STEER_PORT = process.env.STEER_PORT || "D";
const DRIVE_PORTS = (process.env.DRIVE_PORTS || "A,B").split(",").map((s) => s.trim());
const INVERT = (process.env.DRIVE_INVERT || "false,false")
  .split(",").map((s) => s.trim() === "true");
const STEER_INVERT = process.env.STEER_INVERT === "true";
const MAX_SPEED = Number(process.env.MAX_SPEED || 70);   // indoor-sane default
const SWEEP_POWER = 30;

const STEER_STEP = 25;
const THROTTLE_STEP = 10;

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const LEFT = "\x1b[D";
const CTRL_C = "\x03";

const poweredUP = new PoweredUP();

poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const steer = await hub.waitForDeviceAtPort(STEER_PORT);
  const drives = [];
  for (const p of DRIVE_PORTS) drives.push(await hub.waitForDeviceAtPort(p));

  console.log(`Calibrating steering on port ${STEER_PORT}...`);
  const stopA = await sweep(steer, SWEEP_POWER, { portName: STEER_PORT });
  const stopB = await sweep(steer, -SWEEP_POWER, { portName: STEER_PORT });
  const { center, halfRange } = computeSteeringRange(
    Math.min(stopA, stopB), Math.max(stopA, stopB)
  );
  await steer.gotoAngle(center, 40);
  await hub.sleep(700);
  await steer.resetZero();
  console.log(`Calibrated. halfRange=${halfRange}, max speed=${MAX_SPEED}\n`);

  let throttle = 0;
  let steerValue = 0;

  const apply = () => {
    for (let i = 0; i < drives.length; i++) {
      drives[i].setPower(INVERT[i] ? -throttle : throttle);
    }
    const s = STEER_INVERT ? -steerValue : steerValue;
    steer.gotoAngle(steerToPosition(s, halfRange), 100);
  };

  const bar = (v) => {
    const n = Math.round(Math.abs(v) / 10);
    const left = v < 0 ? "<".repeat(n).padStart(10) : " ".repeat(10);
    const right = v > 0 ? ">".repeat(n).padEnd(10) : " ".repeat(10);
    return left + "|" + right;
  };

  const hud = () => {
    process.stdout.write(
      `\r steer ${String(steerValue).padStart(4)} ${bar(steerValue)}   ` +
      `throttle ${String(throttle).padStart(4)} ${bar(throttle)}   `
    );
  };

  console.log("Controls");
  console.log("  W / up arrow      throttle forward  (press repeatedly to go faster)");
  console.log("  S / down arrow    throttle back / reverse");
  console.log("  A / left arrow    steer left        D / right arrow   steer right");
  console.log("  C                 centre the steering, keep driving");
  console.log("  SPACE             STOP - throttle to zero, wheels straight");
  console.log("  Q or Ctrl-C       quit (stops the car and centres the wheels)");
  console.log(`\n  Speed capped at ${MAX_SPEED}. Raise it with MAX_SPEED=100.`);
  console.log("  Throttle LATCHES: it holds its value until you change it or hit SPACE.\n");

  if (!process.stdin.isTTY) {
    console.error(
      "\nThis needs a real terminal for keyboard input (stdin is not a TTY).\n" +
      "Run it from your own terminal, or use `npm run selftest` for a scripted version.\n"
    );
    for (const d of drives) d.brake();
    process.exit(1);
  }

  const quit = async () => {
    for (const d of drives) d.brake();
    await steer.gotoAngle(0, 40);
    process.stdout.write("\nStopped, wheels centred.\n");
    process.exit(0);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (key) => {
    if (key === "q" || key === "Q" || key === CTRL_C) return quit();

    switch (key) {
      case "a": case "A": case LEFT:
        steerValue = Math.max(-100, steerValue - STEER_STEP); break;
      case "d": case "D": case RIGHT:
        steerValue = Math.min(100, steerValue + STEER_STEP); break;
      case "w": case "W": case UP:
        throttle = Math.min(MAX_SPEED, throttle + THROTTLE_STEP); break;
      case "s": case "S": case DOWN:
        throttle = Math.max(-MAX_SPEED, throttle - THROTTLE_STEP); break;
      case "c": case "C":
        steerValue = 0; break;
      case " ":
        throttle = 0; steerValue = 0; break;
      default:
        return;
    }
    apply();
    hud();
  });
  hud();
});

console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
