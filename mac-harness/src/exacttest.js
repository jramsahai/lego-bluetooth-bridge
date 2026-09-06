// Replicates drive.js's exact command sequence, then removes one element at a
// time to find which one stops brake() working.
import { PoweredUP } from "node-poweredup";
import { sweep } from "./sweep.js";
import { computeSteeringRange } from "./steering-math.js";

const STEER_PORT = process.env.STEER_PORT || "D";
const DRIVE_PORTS = (process.env.DRIVE_PORTS || "A,B").split(",").map((s) => s.trim());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const steer = await hub.waitForDeviceAtPort(STEER_PORT);
  const drives = [];
  for (const p of DRIVE_PORTS) drives.push(await hub.waitForDeviceAtPort(p));

  const deg = drives.map(() => null);
  drives.forEach((d, i) => d.on("rotate", ({ degrees }) => { deg[i] = degrees; }));
  await wait(400);

  const movedOver = async (ms) => {
    const a = deg.slice();
    await wait(ms);
    return deg.map((d, i) => (d === null || a[i] === null ? NaN : Math.abs(d - a[i])));
  };

  async function scenario(label, { twoMotors, twoSpeeds, steerCmd, awaited }) {
    const used = twoMotors ? drives : [drives[0]];
    for (const m of used) m.setPower(34);
    await wait(800);
    if (steerCmd) { steer.gotoAngle(0, 100); await wait(300); }
    if (twoSpeeds) { for (const m of used) m.setPower(43); await wait(800); }
    await wait(600);

    if (awaited) {
      // Space the writes in time so they cannot race. Do NOT await the
      // library call itself - that promise never settles and hangs.
      for (const m of used) { m.brake(); await wait(20); }
    } else {
      for (const m of used) m.brake();
    }
    await movedOver(900);
    const after = await movedOver(1200);

    for (const m of used) { m.brake(); m.setPower(0); }
    await wait(1500);
    const vals = used.map((_, i) => after[i]);
    const bad = vals.some((v) => v > 3);
    console.log(`  ${label.padEnd(44)} ${vals.map((v) => String(v).padStart(4)).join(" ")}  ${bad ? "<<<< STILL TURNING" : "stopped"}`);
    return bad;
  }

  console.log("\n  (degrees turned in 1.2s, measured 900ms after brake)\n");
  const r1 = await scenario("1. one motor,  one speed,  no steer cmd", { twoMotors: false, twoSpeeds: false, steerCmd: false });
  const r2 = await scenario("2. TWO motors, one speed,  no steer cmd", { twoMotors: true, twoSpeeds: false, steerCmd: false });
  const r3 = await scenario("3. TWO motors, TWO speeds, no steer cmd", { twoMotors: true, twoSpeeds: true, steerCmd: false });
  const r4 = await scenario("4. TWO motors, TWO speeds, WITH steer cmd", { twoMotors: true, twoSpeeds: true, steerCmd: true });

  const r5 = await scenario("5. TWO motors, brakes SPACED 20ms (the fix)", { twoMotors: true, twoSpeeds: true, steerCmd: true, awaited: true });

  console.log("\n=== RESULT ===");
  console.log(`  spacing brakes 20ms apart: ${r5 ? "STILL BROKEN" : "FIXES IT"}`);
  const failed = [["1 motor/1 speed", r1], ["2 motors", r2], ["2 motors + 2 speeds", r3], ["full drive.js sequence", r4]]
    .filter(([, bad]) => bad).map(([k]) => k);
  console.log(failed.length ? `  brake() FAILED in: ${failed.join(", ")}` : "  brake() worked in all four - not reproduced here.");
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
