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

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
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
