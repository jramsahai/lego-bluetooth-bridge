// brake() stops the motor in isolation but not inside drive.js.
// Isolates WHICH part of drive.js's context breaks it.
import { PoweredUP } from "node-poweredup";
import { computeSteeringRange, steerToPosition } from "./steering-math.js";
import { sweep } from "./sweep.js";

const STEER_PORT = process.env.STEER_PORT || "D";
const DRIVE = (process.env.DRIVE_PORTS || "A,B").split(",")[0].trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const motor = await hub.waitForDeviceAtPort(DRIVE);
  const steer = await hub.waitForDeviceAtPort(STEER_PORT);
  let deg = null;
  motor.on("rotate", ({ degrees }) => { deg = degrees; });
  await wait(400);

  const movedOver = async (ms) => {
    const a = deg;
    await wait(ms);
    return a === null || deg === null ? NaN : Math.abs(deg - a);
  };

  // Measure with a settling delay, so deceleration is not mistaken for motion.
  async function attempt(label, extra) {
    motor.setPower(40);
    await wait(1200);
    if (extra) await extra();
    motor.brake();
    await movedOver(900);                 // let it decelerate
    const after = await movedOver(1200);  // genuinely still moving?
    motor.brake();
    motor.setPower(0);
    await wait(1500);
    console.log(`  ${label.padEnd(38)} AFTER=${String(after).padStart(4)}  ${after <= 3 ? "stopped" : "<<<< STILL TURNING"}`);
    return after;
  }

  console.log(`\nDrive port ${DRIVE}, steer port ${STEER_PORT}\n`);

  const a = await attempt("1. plain setPower -> brake (control)", null);

  const b = await attempt("2. with a gotoAngle to steer first", async () => {
    steer.gotoAngle(0, 100);
    await wait(300);
  });

  console.log("\n  running the full steering calibration, as drive.js does...");
  const s1 = await sweep(steer, 30, { portName: STEER_PORT });
  const s2 = await sweep(steer, -30, { portName: STEER_PORT });
  const { center } = computeSteeringRange(Math.min(s1, s2), Math.max(s1, s2));
  await steer.gotoAngle(center, 40);
  await wait(700);
  await steer.resetZero();
  console.log("  calibration done.\n");

  const c = await attempt("3. after full calibration", null);
  const d = await attempt("4. after calibration + gotoAngle", async () => {
    steer.gotoAngle(0, 100);
    await wait(300);
  });

  console.log("\n=== RESULT ===");
  const rows = [["control", a], ["gotoAngle first", b], ["after calibration", c], ["calibration + gotoAngle", d]];
  const broken = rows.filter(([, v]) => v > 3).map(([k]) => k);
  if (broken.length === 0) console.log("  brake() worked in every case - the trigger is something else.");
  else console.log(`  brake() FAILED after: ${broken.join(", ")}`);
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
