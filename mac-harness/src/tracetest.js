// Answers the question in docs/ISSUE-port-a.md directly: when port
// A "ignores" a command, was that command ever written to Bluetooth?
//
// Runs the two contexts from secondcmdtest that bracket the fault (A alone,
// then A and B together) with every BLE byte logged, then reports each
// application-level motor command as WRITTEN or NEVER WRITTEN.
//
// Observed on the car 2026-09-05 (see docs/ISSUE-port-a.md): in the A+B
// context, A's write is issued, B's write follows 40 ms later, only ONE
// "ack write" line appears (attributed to B, 11 ms after it - really A's), A's
// command is reported "acked NEVER", queue[A] shows next=1 with nothing
// transmitted, and every later A.command is NEVER WRITTEN. That is
// @stoprocent/noble's onceExclusive() dropping A's write callback when B's
// write was issued on the same characteristic.
//
// The script always finishes with raw brakes that bypass the library queue.
import { PoweredUP } from "node-poweredup";
import { trace, rawBrake } from "./bletrace.js";

const PORTS = (process.env.DRIVE_PORTS || "A,B").split(",").map((s) => s.trim());
const GAP_MS = Number(process.env.GAP_MS || 40);      // between the A and B commands, as drive.js
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const A = await hub.waitForDeviceAtPort(PORTS[0]);
  const B = await hub.waitForDeviceAtPort(PORTS[1]);
  const tr = trace(hub);
  let degA = null;
  A.on("rotate", ({ degrees }) => { degA = degrees; });
  B.on("rotate", () => {});
  await wait(600);

  const speedA = async (ms) => { const a = degA; await wait(ms); return Math.abs(degA - a); };
  const results = [];
  const cmd = (dev, label, fn) => {
    const t = Date.now();
    tr.mark(`app: ${label}`);
    fn();
    results.push({ dev, label, t });
  };

  async function trial(name, withB) {
    tr.mark(`===== ${name} =====`);
    cmd(A, `${name}: A.setPower(30)`, () => A.setPower(30));
    if (withB) { await wait(GAP_MS); cmd(B, `${name}: B.setPower(30)`, () => B.setPower(30)); }
    await wait(1000);
    const slow = await speedA(1000);
    cmd(A, `${name}: A.setPower(70)`, () => A.setPower(70));
    if (withB) { await wait(GAP_MS); cmd(B, `${name}: B.setPower(70)`, () => B.setPower(70)); }
    await wait(1000);
    const fast = await speedA(1000);
    cmd(A, `${name}: A.brake()`, () => A.brake());
    if (withB) { await wait(GAP_MS); cmd(B, `${name}: B.brake()`, () => B.brake()); }
    await wait(1200);
    const still = await speedA(1000);
    tr.mark(`${name}: slow=${slow} fast=${fast} afterBrake=${still}  ${fast / Math.max(slow, 1) > 1.4 && still <= 3 ? "healthy" : "<<<< PORT A NOT FOLLOWING COMMANDS"}`);
  }

  await trial("1. A alone", false);
  await trial(`2. A + B (${GAP_MS}ms apart)`, true);

  // Stop everything WITHOUT the library queue, whatever state it is in.
  tr.mark("raw brakes (bypass queue)");
  await rawBrake(hub, A.portId);
  await wait(GAP_MS);
  await rawBrake(hub, B.portId);
  await wait(1500);

  console.log("\n===== DID EACH COMMAND REACH BLUETOOTH? =====");
  for (const r of results) {
    // A matching TX is a port output for this port within 500ms after the app call.
    const hit = tr.tx.find((x) => x.t >= r.t && x.t < r.t + 500 && x.bytes[2] === 0x81 && x.bytes[3] === r.dev.portId);
    console.log(`  ${r.label.padEnd(36)} ${hit ? `written after ${hit.t - r.t}ms, acked ${hit.ackedAt ? hit.ackedAt - hit.t + "ms later" : "NEVER"}` : "<<<< NEVER WRITTEN TO BLE"}`);
  }
  console.log(`\n  final ${tr.queueState(A.portId)}`);
  console.log(`  final ${tr.queueState(B.portId)}`);
  console.log("\n  A NEVER WRITTEN line = the library queue is wedged (see test/poweredup-queue.test.js).");
  console.log("  If every line says written and port A still did not follow, the hub ignored a real command.");
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
