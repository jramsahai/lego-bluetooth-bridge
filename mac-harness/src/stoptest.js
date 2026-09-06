// Empirically determines which stop command this hardware actually obeys.
// Uses rotation events to detect motion objectively rather than by eye.
import { PoweredUP } from "node-poweredup";

const PORT = (process.env.DRIVE_PORTS || "A,B").split(",")[0].trim();
const POWER = Number(process.env.POWER || 40);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const motor = await hub.waitForDeviceAtPort(PORT);

  console.log(`\nport ${PORT}: ${motor.constructor.name}`);
  const methods = new Set();
  let proto = Object.getPrototypeOf(motor);
  while (proto && proto !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(proto)) {
      if (typeof motor[n] === "function" && !n.startsWith("_") && n !== "constructor") methods.add(n);
    }
    proto = Object.getPrototypeOf(proto);
  }
  console.log(`available methods: ${[...methods].sort().join(", ")}\n`);

  let deg = null;
  motor.on("rotate", ({ degrees }) => { deg = degrees; });
  await wait(400);

  // Returns how many degrees the motor turned over `ms`.
  const movement = async (ms) => {
    const a = deg;
    await wait(ms);
    return a === null || deg === null ? NaN : Math.abs(deg - a);
  };

  console.log(`starting motor at power ${POWER}...`);
  motor.setPower(POWER);
  console.log(`  moving: ${await movement(1500)} deg in 1500ms  (expect a large number)\n`);

  const attempts = [
    ["setPower(0)", () => motor.setPower(0)],
    ["brake()", () => motor.brake()],
    ["stop()", () => (typeof motor.stop === "function" ? motor.stop() : null)],
    ["setPower(127)", () => motor.setPower(127)],
  ];

  for (const [label, fn] of attempts) {
    console.log(`trying ${label} ...`);
    try {
      fn();
    } catch (err) {
      console.log(`  THREW: ${err.message}`);
      continue;
    }
    const moved = await movement(1500);
    if (moved <= 2) {
      console.log(`  STOPPED (${moved} deg in 1500ms)  <=== THIS ONE WORKS\n`);
      console.log(`RESULT: use ${label} to stop this motor.`);
      motor.brake();
      process.exit(0);
    }
    console.log(`  still turning: ${moved} deg in 1500ms\n`);
  }

  console.log("RESULT: none of the tried commands stopped the motor.");
  process.exit(1);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
