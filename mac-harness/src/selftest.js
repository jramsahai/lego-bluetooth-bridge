// Scripted direction test — no keyboard, no TTY needed.
// Answers the two questions the interactive drive script exists to answer:
//   1. Do the two drive motors turn the same way?
//   2. Does a negative steer command actually steer the car left?
// Watch the car; the script narrates each step before it does it.
import { PoweredUP } from "node-poweredup";
import { computeSteeringRange, steerToPosition } from "./steering-math.js";
import { sweep } from "./sweep.js";

const STEER_PORT = process.env.STEER_PORT || "D";
const DRIVE_PORTS = (process.env.DRIVE_PORTS || "A,B").split(",");
const INVERT = (process.env.DRIVE_INVERT || "false,false")
  .split(",")
  .map((s) => s.trim() === "true");
const SWEEP_POWER = 30;
const DRIVE_POWER = 40;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();

poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const steer = await hub.waitForDeviceAtPort(STEER_PORT);
  const drives = [];
  for (const p of DRIVE_PORTS) drives.push(await hub.waitForDeviceAtPort(p));

  console.log(`\nCalibrating steering on port ${STEER_PORT}...`);
  const stopA = await sweep(steer, SWEEP_POWER, { portName: STEER_PORT });
  const stopB = await sweep(steer, -SWEEP_POWER, { portName: STEER_PORT });
  const { center, halfRange } = computeSteeringRange(
    Math.min(stopA, stopB),
    Math.max(stopA, stopB)
  );
  await steer.gotoAngle(center, 40);
  await wait(700);
  await steer.resetZero();
  console.log(`Calibrated. halfRange=${halfRange}\n`);
  console.log(`Drive inversion under test: ${DRIVE_PORTS[0]}=${INVERT[0]}, ${DRIVE_PORTS[1]}=${INVERT[1]}`);

  console.log("\n--- STEP 1 of 3: both drive motors FORWARD for 3 seconds ---");
  console.log("    WATCH: do both drive wheels turn the SAME direction?");
  await wait(1500);
  for (let i = 0; i < drives.length; i++) {
    drives[i].setPower(INVERT[i] ? -DRIVE_POWER : DRIVE_POWER);
  }
  await wait(3000);
  for (const d of drives) d.brake();
  console.log("    (stopped)");

  await wait(1500);
  console.log("\n--- STEP 2 of 3: steering to FULL LEFT for 3 seconds ---");
  console.log("    WATCH: do the front wheels point LEFT, as seen from behind the car?");
  await wait(1500);
  await steer.gotoAngle(steerToPosition(-100, halfRange), 60);
  await wait(3000);

  console.log("\n--- STEP 3 of 3: steering to FULL RIGHT for 3 seconds ---");
  await wait(500);
  await steer.gotoAngle(steerToPosition(100, halfRange), 60);
  await wait(3000);

  await steer.gotoAngle(0, 60);
  await wait(800);
  for (const d of drives) d.brake();

  console.log("\n=== DONE — wheels returned to centre ===");
  console.log("Report back:");
  console.log("  1. In step 1, did both drive wheels turn the same way, or fight each other?");
  console.log("  2. In step 2, did the wheels point LEFT or RIGHT?");
  process.exit(0);
});

console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
