// Tests whether port B's involvement during a steering sweep is what breaks
// port A. Once A breaks it stays broken, so ONE mode per run.
//   MODE=1  B running during the steering sweep   (the hypothesis)
//   MODE=2  B acquired+subscribed but idle during the sweep
//   MODE=3  B never acquired at all               (known-healthy control)
import { PoweredUP } from "node-poweredup";
import { sweep } from "./sweep.js";

const MODE = process.env.MODE || "1";
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

  let B = null;
  if (MODE !== "3") {
    B = await hub.waitForDeviceAtPort(PORTS[1]);
    B.on("rotate", () => {});
  }
  await wait(400);

  const speedA = async (ms) => { const a = degA; await wait(ms); return Math.abs(degA - a); };

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
    console.log(`  ${label.padEnd(30)} slow=${String(slow).padStart(4)} fast=${String(fast).padStart(4)} ratio=${ratio.toFixed(2)}  ${ratio > 1.4 ? "healthy" : "<<<< PORT A BROKEN"}`);
  }

  const desc = { "1": "B RUNNING during the sweep", "2": "B idle but subscribed", "3": "B never acquired" }[MODE];
  console.log(`\n  MODE ${MODE}: ${desc}\n`);

  await checkA("before the sweep");

  if (MODE === "1") {
    console.log("  starting port B, then sweeping the steering while it runs...");
    B.setPower(40);
    await wait(500);
  } else {
    console.log("  sweeping the steering...");
  }

  await sweep(steer, 30, { portName: STEER_PORT });
  await sweep(steer, -30, { portName: STEER_PORT });

  if (MODE === "1") { B.brake(); await wait(600); }

  await checkA("after the sweep");
  console.log("\n  Run again with MODE=2 and MODE=3 to compare.");
  console.log("  Power-cycle the hub between runs so port A starts healthy.");
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
