// Tests whether a burst of rapid commands stops later commands getting through.
// Control: a few commands, slowly -> brake should stop the motor.
// Flood:   many commands, fast   -> does the brake still get through?
import { PoweredUP } from "node-poweredup";

const PORT = (process.env.DRIVE_PORTS || "A,B").split(",")[0].trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const poweredUP = new PoweredUP();
poweredUP.on("discover", async (hub) => {
  await hub.connect();
  const motor = await hub.waitForDeviceAtPort(PORT);
  let deg = null;
  motor.on("rotate", ({ degrees }) => { deg = degrees; });
  await wait(400);

  const movedOver = async (ms) => {
    const a = deg;
    await wait(ms);
    return a === null || deg === null ? NaN : Math.abs(deg - a);
  };

  // --- CONTROL: few commands, spaced out ---
  console.log("\n=== CONTROL: 2 commands, seconds apart ===");
  motor.setPower(40);
  console.log(`  running: ${await movedOver(1500)} deg`);
  motor.brake();
  const ctrl = await movedOver(1500);
  console.log(`  after brake(): ${ctrl} deg  ${ctrl <= 2 ? "STOPPED" : "STILL TURNING"}`);

  await wait(1500);

  // --- FLOOD: many commands in quick succession, as key-repeat would ---
  console.log("\n=== FLOOD: 30 rapid commands, then brake ===");
  motor.setPower(40);
  await wait(600);
  for (let i = 0; i < 30; i++) {
    motor.setPower(30 + (i % 20));   // vary so nothing is deduplicated
    await wait(30);                  // ~33 commands/sec, like held keys
  }
  console.log(`  after the flood, still running: ${await movedOver(800)} deg`);
  motor.brake();
  const flood = await movedOver(1500);
  console.log(`  after brake(): ${flood} deg  ${flood <= 2 ? "STOPPED" : "STILL TURNING"}`);

  console.log("\n=== RESULT ===");
  if (ctrl <= 2 && flood > 2) {
    console.log("  Flooding the hub with commands BREAKS later commands.");
    console.log("  Fix: rate-limit commands instead of sending one per keypress.");
  } else if (ctrl <= 2 && flood <= 2) {
    console.log("  Brake works in both cases - command volume is NOT the problem.");
  } else {
    console.log("  Even the control case failed to stop. Something else is wrong.");
  }
  motor.brake();
  await wait(500);
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
