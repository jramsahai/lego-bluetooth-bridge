// Port A will not stop while port B is running, but stops fine alone.
// Distinguishes a lost command from the two axles being mechanically linked.
import { PoweredUP } from "node-poweredup";

const DRIVE_PORTS = (process.env.DRIVE_PORTS || "A,B").split(",").map((s) => s.trim());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const m = [];
  for (const p of DRIVE_PORTS) m.push(await hub.waitForDeviceAtPort(p));
  const deg = m.map(() => null);
  m.forEach((d, i) => d.on("rotate", ({ degrees }) => { deg[i] = degrees; }));
  await wait(400);

  const movedOver = async (ms) => {
    const a = deg.slice();
    await wait(ms);
    return deg.map((d, i) => (d === null || a[i] === null ? NaN : Math.abs(d - a[i])));
  };

  async function trial(label, stopFn) {
    m[0].setPower(40);
    await wait(60);
    m[1].setPower(40);
    await wait(1200);
    await stopFn();
    await movedOver(900);
    const after = await movedOver(1200);
    for (const d of m) { d.brake(); await wait(60); }
    await wait(1500);
    console.log(
      `  ${label.padEnd(40)} ${DRIVE_PORTS[0]}=${String(after[0]).padStart(4)}  ` +
      `${DRIVE_PORTS[1]}=${String(after[1]).padStart(4)}`
    );
    return after;
  }

  console.log("\n  Both motors running, then stopping in different ways.");
  console.log("  (degrees each motor turned in 1.2s, measured 900ms after)\n");

  await trial("brake A ONLY (B left running)", async () => { m[0].brake(); });
  await trial("brake B ONLY (A left running)", async () => { m[1].brake(); });
  await trial("brake A then B", async () => { m[0].brake(); await wait(60); m[1].brake(); });
  await trial("brake B then A (reverse order)", async () => { m[1].brake(); await wait(60); m[0].brake(); });
  await trial("brake A, B, then A again", async () => {
    m[0].brake(); await wait(60); m[1].brake(); await wait(60); m[0].brake();
  });
  await trial("setPower(0) both, spaced", async () => {
    m[0].setPower(0); await wait(60); m[1].setPower(0);
  });

  console.log("\nIf 'brake A ONLY' leaves A turning while B runs, the axles are");
  console.log("mechanically linked and B is back-driving A - no command is lost.");
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
