// Replays the ESP32 firmware's exact motor commands (as Legoino sends them)
// against the real car and reports what the hub does with each one. Run this
// before trusting the firmware: the harness validated StartPower, brake (127),
// GotoAbsolutePosition and PresetEncoder, but the firmware ALSO uses Legoino's
// setTachoMotorSpeed / stopTachoMotor, whose sub-command 0x01 is a one-byte
// StartPower in LWP3 with three unexpected trailing bytes, and whose speed
// byte is Legoino's MapSpeed rescaling (0 -> 127, 100 -> 126) rather than the
// int8 the harness sends. Nobody knows what the hub does with that, and the
// firmware's failsafe stop depended on it until esp32/lib/ctrl/lwp3 replaced
// every Legoino motor helper with bytes pinned to this harness's test vectors.
//
// Car on a stand, wheels off the ground. Power-cycle the hub first.
import { PoweredUP } from "node-poweredup";
import { rawMotor } from "./rawmotor.js";
import { trace } from "./bletrace.js";
import { sweep } from "./sweep.js";
import { computeSteeringRange } from "./steering-math.js";

const STEER_PORT = process.env.STEER_PORT || "D";
const DRIVE_PORTS = (process.env.DRIVE_PORTS || "A,B").split(",").map((s) => s.trim());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const report = (step, pass, detail) => {
  results.push({ step, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${step.padEnd(52)} ${detail}`);
};

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const tr = trace(hub, { quiet: true });
  const steer = rawMotor(await hub.waitForDeviceAtPort(STEER_PORT));
  const drives = [];
  for (const p of DRIVE_PORTS) drives.push(rawMotor(await hub.waitForDeviceAtPort(p)));

  const deg = drives.map(() => null);
  drives.forEach((d, i) => d.on("rotate", ({ degrees }) => { deg[i] = degrees; }));
  let steerDeg = null;
  steer.on("rotate", ({ degrees }) => { steerDeg = degrees; });
  await wait(600);

  // Degrees each drive motor turned over `ms`, after a 900 ms settle.
  const movedAfterSettle = async (ms = 1200) => {
    await wait(900);
    const a = deg.slice();
    await wait(ms);
    return deg.map((d, i) => (d === null || a[i] === null ? NaN : Math.abs(d - a[i])));
  };
  // Generic Error messages (type 0x05) the hub sent since `since` lines.
  const errorsSince = (since) => tr.lines.slice(since).filter((l) => l.includes("GENERIC ERROR"));
  const stopAll = async () => { for (const d of drives) { d.brake(); await wait(40); } await wait(1200); };

  console.log("\n  Firmware command check. Each line is one thing the ESP32 will do.\n");

  // ---- 1. Does Legoino's stopTachoMotor (sub-command 0x01, 8 bytes) stop a running motor?
  {
    const mark = tr.lines.length;
    drives[0].setPower(40);
    await wait(1500);
    const running = (await movedAfterSettle(500))[0];
    drives[0].legoinoStopTacho();
    const after = (await movedAfterSettle())[0];
    const errs = errorsSince(mark);
    // A stop can only be judged on a motor that was moving. Observed once on
    // the car (2026-09-06): the motor had not started when this ran, and the
    // line would otherwise have read PASS for nothing.
    const moving = running > 20;
    report("stopTachoMotor bytes stop a running motor", moving && after <= 3 && errs.length === 0,
      `running=${running} after=${after} deg/1.2s, hub errors=${errs.length}` +
      (moving ? "" : "  <- INCONCLUSIVE: motor never ran; rerun (line 4 also covers this stop)"));
    for (const e of errs) console.log(`        ${e}`);
    await stopAll();
  }

  // ---- 2. Does Legoino's setTachoMotorSpeed(30, maxPower 50) drive the steering to a stop?
  {
    const mark = tr.lines.length;
    const legoinoSweepMotor = {
      setPower: (p) => steer.legoinoTachoSpeed(p, { maxPower: 50 }),
      brake: () => steer.brake(),
      on: (e, f) => steer.on(e, f),
      removeListener: (e, f) => steer.removeListener(e, f),
    };
    let stop1 = null, err = null;
    try { stop1 = await sweep(legoinoSweepMotor, 30, { portName: STEER_PORT }); } catch (e) { err = e; }
    const errs = errorsSince(mark);
    report("setTachoMotorSpeed(30,maxPower 50) sweeps steering to a stop", stop1 !== null && errs.length === 0,
      err ? err.message : `stalled at ${stop1}, hub errors=${errs.length}`);
    for (const e of errs) console.log(`        ${e}`);
  }

  // ---- 3. The firmware's whole calibration, with the validated StartPower sweep as the reference.
  let center = null;
  {
    const s1 = await sweep(steer, 30, { portName: STEER_PORT });
    const s2 = await sweep(steer, -30, { portName: STEER_PORT });
    const r = computeSteeringRange(Math.min(s1, s2), Math.max(s1, s2));
    center = r.center;
    await steer.gotoAngle(center, 40, { maxPower: 100 });   // firmware: setAbsoluteMotorPosition(port, 40, center, 100)
    await wait(800);
    const before = steerDeg;
    await steer.resetZero();                                 // firmware: setAbsoluteMotorEncoderPosition(port, 0)
    await wait(400);
    const near = Math.abs(steerDeg) <= 3;
    report("gotoAngle(center,40) then resetZero reads ~0", near,
      `span=${s1}..${s2} center=${center} pos before zero=${before} after=${steerDeg}`);
  }

  // ---- 4. The firmware's drive path: setBasicMotorSpeed both (30 ms apart), then stopTachoMotor twice each, 30 ms apart.
  {
    const mark = tr.lines.length;
    drives[0].setPower(40); await wait(30); drives[1].setPower(40);
    await wait(1500);
    const running = await movedAfterSettle(500);
    for (let pass = 0; pass < 2; pass++) for (const d of drives) { d.legoinoStopTacho(); await wait(30); }
    const after = await movedAfterSettle();
    const errs = errorsSince(mark);
    report("firmware failsafe sequence stops both drive motors", after.every((v) => v <= 3) && errs.length === 0,
      `running=${running.join("/")} after=${after.join("/")} deg/1.2s, hub errors=${errs.length}`);
    await stopAll();
  }

  // ---- 5. The firmware's steering-to-centre on stop: setAbsoluteMotorPosition(port, 60, 0, 100).
  {
    await steer.gotoAngle(60, 60);
    await wait(700);
    await steer.gotoAngle(0, 60, { maxPower: 100 });
    await wait(900);
    report("setAbsoluteMotorPosition(60, 0) returns steering to centre", Math.abs(steerDeg) <= 4, `pos=${steerDeg}`);
  }

  await stopAll();
  await steer.gotoAngle(0, 40);
  await wait(600);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log("  FAILED: " + failed.map((f) => f.step).join("; "));
    console.log("  A failing stopTachoMotor line means the firmware's failsafe stop does not work as written.");
    console.log("  See esp32/src/main.cpp stopEverything() and docs/BRINGUP.md.");
  }
  process.exit(failed.length ? 1 : 0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
