import { PoweredUP } from "node-poweredup";
import { computeSteeringRange } from "./steering-math.js";
import { sweep } from "./sweep.js";

const STEER_PORT = process.env.STEER_PORT || "A";
const SWEEP_POWER = 30;
const TIMEOUT_MS = 3000;

const poweredUP = new PoweredUP();

poweredUP.on("discover", async (hub) => {
  await hub.connect();
  console.log(`Connected to ${hub.name}. Calibrating steering on port ${STEER_PORT}.`);
  const motor = await hub.waitForDeviceAtPort(STEER_PORT);

  const stopA = await sweep(motor, SWEEP_POWER, { timeoutMs: TIMEOUT_MS, portName: STEER_PORT });
  console.log(`  stop 1 at POS = ${stopA}`);
  const stopB = await sweep(motor, -SWEEP_POWER, { timeoutMs: TIMEOUT_MS, portName: STEER_PORT });
  console.log(`  stop 2 at POS = ${stopB}`);

  const lo = Math.min(stopA, stopB);
  const hi = Math.max(stopA, stopB);
  const { center, halfRange } = computeSteeringRange(lo, hi);
  console.log(`\n  raw span: ${lo} .. ${hi}  (${hi - lo} degrees)`);
  console.log(`  center=${center}  halfRange=${halfRange}`);

  console.log("\nDriving to center and zeroing the encoder there...");
  await motor.gotoAngle(center, 40);
  await hub.sleep(600);
  await motor.resetZero();
  console.log("Done. Wheels should now point straight ahead.");
  console.log(`\nRecord: steerHalfRange = ${halfRange}`);
  process.exit(0);
});

poweredUP.scan();
