// node-poweredup 10.x puts a per-port command queue in front of every motor
// write (Device.sendPortOutputCommand / transmitNextPortOutputCommand /
// finish). A command leaves the head of that queue only when the promise from
// the BLE write resolves, and the queue only advances past it when the hub's
// Port Output Command Feedback (0x82) reconciles with the library's count of
// in-flight commands.
//
// These tests drive that queue with a fake hub whose BLE write promise and
// feedback delivery we control, so we can reproduce - deterministically and
// without a car - the orderings that leave a port permanently unable to send.
//
// The first test is the mechanism observed on the car with `npm run trace`:
// @stoprocent/noble's Characteristic.write registers its completion callback
// with onceExclusive(), which REMOVES the previous pending callback. So when a
// second write to the hub (any port) is issued before the first write's ATT
// acknowledgement (~50-65 ms) comes back, the first write's promise never
// resolves. node-poweredup then leaves that command at the head of its port
// queue in TRANSMISSION_BUSY forever and never writes anything else for that
// port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
// Deep imports: the package entry point loads the Bluetooth stack, which keeps
// the event loop alive and hangs the test runner.
import { TechnicLargeLinearMotor } from "node-poweredup/dist/devices/techniclargelinearmotor.js";
import * as Consts from "node-poweredup/dist/consts.js";

const tick = () => new Promise((r) => setImmediate(r));

class FakeHub extends EventEmitter {
  constructor() {
    super();
    this.type = Consts.HubType.TECHNIC_MEDIUM_HUB;
    this.writes = [];          // every Buffer handed to the BLE layer
    this.pending = [];         // resolvers for writes not yet acknowledged
  }
  isPortVirtual() { return false; }
  getPortNameForPortId(id) { return "ABCD"[id]; }
  subscribe() {}
  send(buf) {
    this.writes.push(Buffer.from(buf));
    return new Promise((resolve) => this.pending.push(resolve));
  }
  // Simulate the ATT write response arriving for the oldest outstanding write.
  async ackWrite() {
    const r = this.pending.shift();
    if (!r) throw new Error("no write outstanding to ack");
    r();
    await tick();
  }
  // Simulate noble's onceExclusive dropping the oldest pending callback because
  // another write was issued on the same characteristic before it completed.
  dropOldestAck() { this.pending.shift(); }
  // Simulate the hub's 0x82 feedback notification for this port.
  async feedback(device, byte) {
    device.finish(byte);
    await tick();
  }
}

const power = (buf) => buf[buf.length - 1];   // last byte of 0x81 pp ss 0x51 0x00 <power>
const forPort = (hub, id) => hub.writes.filter((b) => b[1] === id);

function motors(hub, ...ids) {
  return ids.map((id) => new TechnicLargeLinearMotor(hub, id, undefined, Consts.DeviceType.TECHNIC_LARGE_LINEAR_MOTOR));
}

test("OBSERVED ON THE CAR: a second port's write overlapping the first's ack wedges the first port", async () => {
  const hub = new FakeHub();
  const [A, B] = motors(hub, 0, 1);

  A.setPower(30);
  await tick();
  B.setPower(30);                     // 40 ms later on the car; A's ack takes ~55 ms
  await tick();
  assert.equal(hub.writes.length, 2, "both writes reach the BLE layer");

  hub.dropOldestAck();                // noble: onceExclusive removed A's callback
  await hub.ackWrite();               // the single 'write' event resolves B's promise
  await hub.feedback(A, 0x0a);        // the hub's feedback for A still arrives
  await hub.feedback(B, 0x0a);

  A.setPower(70); await tick();
  B.setPower(70); await tick(); await hub.ackWrite(); await hub.feedback(B, 0x0a);
  A.brake();      await tick();
  B.brake();      await tick(); await hub.ackWrite(); await hub.feedback(B, 0x0a);

  assert.equal(forPort(hub, 1).length, 3, "port B keeps working: 30, 70, brake all written");
  assert.equal(forPort(hub, 0).length, 1,
    "BUG: port A's setPower(70) and brake() are never written; its first command is stuck " +
    `at the head of the queue (next=${A._nextPortOutputCommands.length}, state=${A._nextPortOutputCommands[0]?.state})`);
  assert.equal(A._nextPortOutputCommands.length, 2);
});

test("baseline: writes acknowledged before the next one is issued, everything is sent", async () => {
  const hub = new FakeHub();
  const [A, B] = motors(hub, 0, 1);
  A.setPower(30); await tick(); await hub.ackWrite(); await hub.feedback(A, 0x0a);
  B.setPower(30); await tick(); await hub.ackWrite(); await hub.feedback(B, 0x0a);
  A.setPower(70); await tick(); await hub.ackWrite(); await hub.feedback(A, 0x0a);
  A.brake();      await tick(); await hub.ackWrite(); await hub.feedback(A, 0x0a);
  assert.equal(forPort(hub, 0).length, 3);
  assert.equal(power(forPort(hub, 0)[2]), 0x7f);
});

test("also stalls: feedback arriving before the write acknowledgement", async () => {
  const hub = new FakeHub();
  const [A] = motors(hub, 0);
  A.setPower(30);
  await tick();
  await hub.feedback(A, 0x0a);        // 0x82 delivered before the ATT response
  await hub.ackWrite();

  A.setPower(70); await tick();
  A.brake();      await tick();
  assert.equal(hub.writes.length, 1,
    `BUG: later commands never written (_bufferLength=${A._bufferLength}, transmitted=${A._transmittedPortOutputCommands.length})`);
});

test("feedback 'in progress' (0x01) before the write response happens to stay consistent", async () => {
  const hub = new FakeHub();
  const [A] = motors(hub, 0);
  A.setPower(30); await tick();
  await hub.feedback(A, 0x01);
  await hub.ackWrite();
  A.setPower(70); await tick();
  assert.equal(hub.writes.length, 2, "0x01 leaves bufferLength=1 which matches one transmitted command");
});

test("a raw 0x81 write through hub.send bypasses the wedged queue", async () => {
  const hub = new FakeHub();
  const [A, B] = motors(hub, 0, 1);
  A.setPower(30); await tick();
  B.setPower(30); await tick();
  hub.dropOldestAck(); await hub.ackWrite();
  A.brake(); await tick();
  assert.equal(forPort(hub, 0).length, 1, "precondition: port A is wedged");

  // What src/rawmotor.js does: build the port output command ourselves.
  hub.send(Buffer.from([0x81, A.portId, 0x11, 0x51, 0x00, 0x7f]));
  assert.equal(forPort(hub, 0).length, 2);
  assert.equal(power(forPort(hub, 0)[1]), 0x7f, "brake reaches BLE regardless of the queue");
});
