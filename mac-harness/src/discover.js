import { PoweredUP } from "node-poweredup";

const poweredUP = new PoweredUP();

poweredUP.on("discover", async (hub) => {
  console.log(`Found: ${hub.name}  uuid=${hub.uuid}`);
  await hub.connect();
  console.log("Connected. Waiting 2s for attach events to settle...");
  await hub.sleep(2000);

  console.log("\n=== PORT MAP ===");
  for (const device of hub.getDevices()) {
    console.log(
      `  port ${device.portName}: type=${device.type} class=${device.constructor.name}`
    );
  }
  console.log(`\nBattery: ${hub.batteryLevel}%`);
  console.log("\nRecord this table in docs/hardware-map.md, then Ctrl-C.");
});

console.log("Scanning. Press the green button on the hub to make it discoverable.");
poweredUP.scan();
