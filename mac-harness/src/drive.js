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
// A geared LEGO motor will not sustain rotation at a low duty cycle: it kicks,
// stalls, and sits there whining. motortest showed these motors run happily at
// 40, so throttle is mapped onto MIN_POWER..MAX_SPEED rather than 0..MAX_SPEED,
// which makes the very first press actually move the car.
const MIN_POWER = Number(process.env.MIN_POWER || 25);
const SWEEP_POWER = 30;

const STEER_STEP = 25;
const THROTTLE_STEP = 20;

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

  // Map a -100..100 throttle onto real motor power, with a floor so the
  // first press does something instead of stalling the motor.
  const toPower = (t) => {
    if (t === 0) return 0;
    const mag = MIN_POWER + ((MAX_SPEED - MIN_POWER) * Math.abs(t)) / 100;
    return Math.round(Math.sign(t) * Math.min(mag, 100));
  };

  let lastSteerCmd = null;
  let lastPower = null;

  // Objective check that a brake actually took effect, rather than trusting
  // that issuing the command was enough.
  const driveDeg = drives.map(() => null);
  drives.forEach((d, i) => d.on("rotate", ({ degrees }) => { driveDeg[i] = degrees; }));
  const verifyStopped = (i) => {
    const before = driveDeg[i];
    setTimeout(() => {
      const after = driveDeg[i];
      if (before === null || after === null) return;
      const moved = Math.abs(after - before);
      log(
        moved <= 2
          ? `port ${DRIVE_PORTS[i]} CONFIRMED STOPPED (${moved} deg in 800ms)`
          : `port ${DRIVE_PORTS[i]} STILL TURNING after brake (${moved} deg in 800ms)`
      );
    }, 800);
  };

  // The HUD repaints with a carriage return, so a log line written without a
  // trailing newline gets overwritten by the next HUD frame - which made it
  // look as though commands to the second drive motor were never sent.
  // Clear the current line, emit a complete line, and let the HUD repaint.
  const log = (msg) => {
    if (process.env.QUIET === "1") return;
    process.stdout.write(`\r\x1b[K[cmd] ${msg}\n`);
  };

  const apply = () => {
    const power = toPower(throttle);
    if (power !== lastPower) {
      for (let i = 0; i < drives.length; i++) {
        // brake() actively stops; setPower(0) leaves the motor coasting -
        // measured at 56 degrees of continued rotation on the real car.
        if (power === 0) {
          drives[i].brake();
          log(`brake() -> port ${DRIVE_PORTS[i]}`);
          verifyStopped(i);
        } else {
          const p = INVERT[i] ? -power : power;
          drives[i].setPower(p);
          log(`setPower(${p}) -> port ${DRIVE_PORTS[i]}`);
        }
      }
      lastPower = power;
    } else {
      log(`throttle ${throttle} -> power ${power} UNCHANGED, nothing sent (lastPower=${lastPower})`);
    }
    // Only re-command the steering when the target actually moved. Sending
    // gotoAngle on every keypress makes the motor actively servo to hold a
    // position it is already at, which is where the constant whine came from.
    const s = STEER_INVERT ? -steerValue : steerValue;
    const target = steerToPosition(s, halfRange);
    if (target !== lastSteerCmd) {
      steer.gotoAngle(target, 100);
      log(`gotoAngle(${target}) -> port ${STEER_PORT}`);
      lastSteerCmd = target;
    }
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
      `throttle ${String(throttle).padStart(4)} ${bar(throttle)} ` +
      `power ${String(toPower(throttle)).padStart(4)}   `
    );
  };

  console.log("Controls");
  console.log("  W / up arrow      throttle forward  (press repeatedly to go faster)");
  console.log("  S / down arrow    throttle back / reverse");
  console.log("  A / left arrow    steer left        D / right arrow   steer right");
  console.log("  C                 centre the steering, keep driving");
  console.log("  SPACE             STOP - throttle to zero, wheels straight");
  console.log("  Q or Ctrl-C       quit (stops the car and centres the wheels)");
  console.log(`\n  Throttle maps onto motor power ${MIN_POWER}..${MAX_SPEED}.`);
  console.log("  Raise the ceiling with MAX_SPEED=100, lower the floor with MIN_POWER=15.");
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
  // A crash here would leave the car driving away, so every failure path
  // stops the motors first and says what happened.
  const panic = (label) => (err) => {
    try { for (const d of drives) d.brake(); } catch (_) {}
    process.stdout.write(`\n\n!! ${label}: ${err && err.message ? err.message : err}\n`);
    process.stdout.write("!! motors braked. If the car is still moving, hold the hub button.\n");
    process.exit(1);
  };
  process.on("uncaughtException", panic("uncaught exception"));
  process.on("unhandledRejection", panic("unhandled rejection"));
  hub.on("disconnect", () => {
    process.stdout.write("\n\n!! hub disconnected - the car may keep its last command.\n");
    process.stdout.write("!! hold the hub button to power it off.\n");
    process.exit(1);
  });

  process.stdin.on("data", async (key) => {
   try {
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
        // Hard stop. Deliberately bypasses the change-gate and brakes every
        // drive motor directly, so a stale cache can never swallow a stop.
        throttle = 0;
        steerValue = 0;
        for (let i = 0; i < drives.length; i++) drives[i].brake();
        lastPower = 0;
        log("SPACE: direct brake() on all drive motors");
        break;
      default:
        return;
    }
    apply();
    hud();
   } catch (err) {
    panic("key handler failed")(err);
   }
  });
  hud();
});

console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
