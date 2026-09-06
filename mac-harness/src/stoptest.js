// Ranks stop commands with a settling delay, so deceleration is not mistaken
// for a failure to stop. Earlier versions measured from the instant the
// command was sent and counted the stopping transient as "still turning".
import { PoweredUP } from "node-poweredup";

const PORT = (process.env.DRIVE_PORTS || "A,B").split(",")[0].trim();
const POWER = Number(process.env.POWER || 40);
const SETTLE_MS = 900;    // let it decelerate before judging
const MEASURE_MS = 1500;  // then see if it is genuinely still moving
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

  async function trial(label, stopFn) {
    motor.setPower(POWER);
    const running = await movedOver(1200);
    stopFn();
    const during = await movedOver(SETTLE_MS);      // the stopping transient
    const after = await movedOver(MEASURE_MS);      // genuinely still moving?
    motor.brake();
    await wait(1200);
    console.log(
      `  ${label.padEnd(14)} running=${String(running).padStart(4)}  ` +
      `during-stop=${String(during).padStart(4)}  AFTER=${String(after).padStart(4)}  ` +
      `${after <= 3 ? "<-- fully stopped" : "<-- STILL MOVING"}`
    );
    return after;
  }

  console.log(`\nport ${PORT}, power ${POWER}. "AFTER" is what matters:`);
  console.log(`(degrees turned in ${MEASURE_MS}ms, measured ${SETTLE_MS}ms after the command)\n`);

  const zero = await trial("setPower(0)", () => motor.setPower(0));
  const brk = await trial("brake()", () => motor.brake());

  console.log("\n=== RESULT ===");
  console.log(`  setPower(0): ${zero <= 3 ? "stops the motor" : "leaves it moving"}`);
  console.log(`  brake():     ${brk <= 3 ? "stops the motor" : "leaves it moving"}`);
  if (brk <= 3 && zero > 3) console.log("  -> brake() is required; power 0 only coasts.");
  else if (brk <= 3 && zero <= 3) console.log("  -> both stop it; the earlier distinction was a measurement artefact.");
  else console.log("  -> neither reliably stops it. The problem is not the stop command.");
  process.exit(0);
});
console.log("Scanning. Press the green button on the hub if it does not connect.");
poweredUP.scan();
