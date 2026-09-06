// Runs each drive motor ALONE and reports whether the motor itself keeps
// turning. Distinguishes a motor that cuts out (electrical/software) from a
// wheel that stops while the motor keeps spinning (a slipping drivetrain).
import { PoweredUP } from "node-poweredup";

const DRIVE_PORTS = (process.env.DRIVE_PORTS || "A,B").split(",");
const POWER = Number(process.env.POWER || 40);
const RUN_MS = Number(process.env.RUN_MS || 6000);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(hub, portName) {
  const motor = await hub.waitForDeviceAtPort(portName);
  let deg = null;
  let events = 0;
  const onRotate = ({ degrees }) => { deg = degrees; events++; };
  motor.on("rotate", onRotate);
  await wait(300);

  console.log(`\n=== PORT ${portName} alone, power ${POWER}, ${RUN_MS}ms ===`);
  console.log(`    WATCH: which wheels turn, and when do they stop?`);
  await wait(1500);

  const start = deg;
  let prev = deg;
  const t0 = Date.now();
  motor.setPower(POWER);
  while (Date.now() - t0 < RUN_MS) {
    await wait(500);
    const el = Date.now() - t0;
    const delta = deg === null || prev === null ? 0 : deg - prev;
    console.log(
      `  t=${String(el).padStart(4)}ms  pos=${String(deg).padStart(7)}  ` +
      `turned last 500ms=${String(delta).padStart(6)} deg  ${delta === 0 ? "<-- MOTOR NOT TURNING" : ""}`
    );
    prev = deg;
  }
  motor.brake();
  motor.removeListener("rotate", onRotate);
  const total = deg === null || start === null ? 0 : deg - start;
  console.log(`  TOTAL: ${total} degrees over ${RUN_MS}ms, ${events} rotate events`);
  await wait(1200);
  return total;
}

// Runs BOTH drive motors at once, logging each separately. This is the
// condition under which the front wheels were seen to stop; running the
// motors one at a time does not reproduce it.
async function runBoth(hub) {
  const motors = [];
  for (const p of DRIVE_PORTS) motors.push(await hub.waitForDeviceAtPort(p));
  const deg = DRIVE_PORTS.map(() => null);
  const events = DRIVE_PORTS.map(() => 0);
  const handlers = motors.map((m, i) => {
    const h = ({ degrees }) => { deg[i] = degrees; events[i]++; };
    m.on("rotate", h);
    return h;
  });
  await wait(300);

  console.log(`\n=== BOTH PORTS ${DRIVE_PORTS.join(" + ")} TOGETHER, power ${POWER}, ${RUN_MS}ms ===`);
  console.log(`    WATCH: note the moment either axle stops.`);
  await wait(1500);

  const start = deg.slice();
  let prev = deg.slice();
  const t0 = Date.now();
  for (const m of motors) m.setPower(POWER);
  while (Date.now() - t0 < RUN_MS) {
    await wait(500);
    const el = Date.now() - t0;
    const parts = DRIVE_PORTS.map((p, i) => {
      const d = deg[i] === null || prev[i] === null ? 0 : deg[i] - prev[i];
      return `${p}: ${String(d).padStart(5)} deg${d === 0 ? " <-- STOPPED" : ""}`;
    });
    console.log(`  t=${String(el).padStart(4)}ms   ${parts.join("   |   ")}`);
    prev = deg.slice();
  }
  for (const m of motors) m.brake();
  motors.forEach((m, i) => m.removeListener("rotate", handlers[i]));
  console.log(`  TOTALS: ` + DRIVE_PORTS.map((p, i) =>
    `${p}=${deg[i] - start[i]} deg (${events[i]} events)`).join("  "));
  await wait(1200);
}

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  if (process.env.BOTH === "1") {
    await runBoth(hub);
    console.log("\nReport which axle stopped and at roughly what time.");
    process.exit(0);
  }
  console.log(`Connected. Testing drive ports ${DRIVE_PORTS.join(" and ")} one at a time.`);
  const totals = {};
  for (const p of DRIVE_PORTS) totals[p] = await runOne(hub, p);

  console.log(`\n=== SUMMARY ===`);
  for (const p of DRIVE_PORTS) {
    console.log(`  port ${p}: ${totals[p]} degrees total`);
  }
  console.log(
    `\nIf a port's motor kept turning the whole time but its wheels stopped,\n` +
    `the drivetrain is slipping mechanically, not failing electrically.`
  );
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
