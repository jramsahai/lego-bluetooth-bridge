// The steering calibration leaves port A ignoring its commanded power and
// running flat out. Bisects which step of the calibration does it.
import { PoweredUP } from "node-poweredup";
import { sweep } from "./sweep.js";
import { computeSteeringRange } from "./steering-math.js";

const STEER_PORT = process.env.STEER_PORT || "D";
const PORTS = (process.env.DRIVE_PORTS || "A,B").split(",").map((s) => s.trim());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const steer = await hub.waitForDeviceAtPort(STEER_PORT);
  const A = await hub.waitForDeviceAtPort(PORTS[0]);
  let degA = null;
  A.on("rotate", ({ degrees }) => { degA = degrees; });
  await wait(400);

  const speedA = async (ms) => { const a = degA; await wait(ms); return Math.abs(degA - a); };

  // Healthy: power 30 gives roughly a third of power 70.
  async function checkA(label) {
    A.setPower(30);
    await wait(1000);
    const slow = await speedA(1000);
    A.setPower(70);
    await wait(1000);
    const fast = await speedA(1000);
    A.brake();
    await wait(1200);
    const ratio = slow > 0 ? fast / slow : 0;
    const ok = ratio > 1.4;
    console.log(`  ${label.padEnd(40)} slow=${String(slow).padStart(4)} fast=${String(fast).padStart(4)} ratio=${ratio.toFixed(2)}  ${ok ? "healthy" : "<<<< PORT A BROKEN"}`);
    return ok;
  }

  console.log("\n  Port A: power 30 then 70. Healthy means fast >> slow.\n");
  await checkA("0. baseline, nothing done yet");

  const s1 = await sweep(steer, 30, { portName: STEER_PORT });
  await checkA("1. after ONE sweep of the steer motor");

  const s2 = await sweep(steer, -30, { portName: STEER_PORT });
  await checkA("2. after the second sweep");

  const { center } = computeSteeringRange(Math.min(s1, s2), Math.max(s1, s2));
  await steer.gotoAngle(center, 40);
  await wait(700);
  await checkA("3. after gotoAngle(center)");

  await steer.resetZero();
  await checkA("4. after resetZero()");

  console.log("\n  The first BROKEN row names the step that does it.");
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
