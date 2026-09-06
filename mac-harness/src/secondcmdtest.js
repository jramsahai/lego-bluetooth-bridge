// Does port A accept a SECOND command? Measures the speed change between a
// low and a high power command, under four different contexts.
//
//   npm run secondcmd          motors driven through node-poweredup's queue
//                              (the path that reproduced the port A fault)
//   RAW=1 npm run secondcmd    motors driven by raw writes (src/rawmotor.js),
//                              the fix. All four rows should read WORKED.
// Power-cycle the hub between the two runs: a wedged port stays wedged.
import { PoweredUP } from "node-poweredup";
import { sweep } from "./sweep.js";
import { computeSteeringRange } from "./steering-math.js";
import { rawMotor } from "./rawmotor.js";

const STEER_PORT = process.env.STEER_PORT || "D";
const PORTS = (process.env.DRIVE_PORTS || "A,B").split(",").map((s) => s.trim());
const RAW = process.env.RAW === "1";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const wrap = RAW ? rawMotor : (d) => d;
  console.log(`\n  motor path: ${RAW ? "RAW writes (bypassing the library queue)" : "node-poweredup queue"}`);
  const steer = wrap(await hub.waitForDeviceAtPort(STEER_PORT));
  const A = wrap(await hub.waitForDeviceAtPort(PORTS[0]));
  const B = wrap(await hub.waitForDeviceAtPort(PORTS[1]));
  let degA = null, degB = null;
  A.on("rotate", ({ degrees }) => { degA = degrees; });
  B.on("rotate", ({ degrees }) => { degB = degrees; });
  await wait(400);

  const speedA = async (ms) => { const a = degA; await wait(ms); return Math.abs(degB === null ? 0 : degA - a); };

  async function trial(label, withB) {
    A.setPower(30);
    if (withB) { await wait(40); B.setPower(30); }
    await wait(1000);
    const slow = await speedA(1000);

    await wait(40);
    A.setPower(70);                 // the SECOND command to port A
    if (withB) { await wait(40); B.setPower(70); }
    await wait(1000);
    const fast = await speedA(1000);

    A.brake(); await wait(40); if (withB) { B.brake(); await wait(40); }
    await wait(1200);
    const ratio = slow > 0 ? (fast / slow) : 0;
    console.log(
      `  ${label.padEnd(34)} slow=${String(slow).padStart(4)} fast=${String(fast).padStart(4)} ` +
      `ratio=${ratio.toFixed(2)}  ${ratio > 1.4 ? "second command WORKED" : "<<<< SECOND COMMAND IGNORED"}`
    );
  }

  console.log("\n  Port A at power 30, then 70. 'fast' should be clearly larger.\n");
  await trial("1. A alone, no calibration", false);
  await trial("2. A + B, no calibration", true);

  console.log("\n  running the steering calibration...");
  const s1 = await sweep(steer, 30, { portName: STEER_PORT });
  const s2 = await sweep(steer, -30, { portName: STEER_PORT });
  const { center } = computeSteeringRange(Math.min(s1, s2), Math.max(s1, s2));
  await steer.gotoAngle(center, 40);
  await wait(700);
  await steer.resetZero();
  console.log("  done.\n");

  await trial("3. A alone, AFTER calibration", false);
  await trial("4. A + B, AFTER calibration", true);
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
