import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { rawMotor } from "../src/rawmotor.js";

class FakeHub extends EventEmitter {
  constructor() { super(); this.writes = []; this.uuids = []; }
  send(buf, uuid) { this.writes.push(Buffer.from(buf)); this.uuids.push(uuid); return Promise.resolve(); }
}
class FakeDevice extends EventEmitter {
  constructor(hub, portId) { super(); this.hub = hub; this.portId = portId; this.portName = "ABCD"[portId]; }
}

const setup = (portId = 0) => {
  const hub = new FakeHub();
  const dev = new FakeDevice(hub, portId);
  return { hub, dev, m: rawMotor(dev) };
};
const hex = (b) => Buffer.from(b).toString("hex");

test("setPower writes Legoino's setBasicMotorSpeed bytes to the LPF2 characteristic", () => {
  const { hub, m } = setup(0);
  m.setPower(30);
  assert.equal(hex(hub.writes[0]), "8100115100" + "1e");
  assert.equal(hub.uuids[0], "00001624-1212-efde-1623-785feabcd123");
});

test("negative power is two's complement, brake is 127, values are clamped", () => {
  const { hub, m } = setup(1);
  m.setPower(-70);
  m.brake();
  m.setPower(250);
  assert.equal(hex(hub.writes[0]), "8101115100ba");   // -70
  assert.equal(hex(hub.writes[1]), "81011151007f");   // brake
  assert.equal(hex(hub.writes[2]), "810111510064");   // clamped to 100
});

test("gotoAngle writes GotoAbsolutePosition with node-poweredup's defaults", () => {
  const { hub, m } = setup(3);
  m.gotoAngle(-105, 40);
  // 0x0d, int32 LE angle, speed, maxPower 100, BRAKE 127, profile 0x03
  assert.equal(hex(hub.writes[0]), "8103110d" + "97ffffff" + "28" + "64" + "7f" + "03");
});

test("resetZero writes PresetEncoder", () => {
  const { hub, m } = setup(3);
  m.resetZero();
  assert.equal(hex(hub.writes[0]), "810311510200000000");
});

test("rotate listeners are delegated to the library device so the encoder still streams", () => {
  const { dev, m } = setup(0);
  let got = null;
  const fn = ({ degrees }) => { got = degrees; };
  m.on("rotate", fn);
  dev.emit("rotate", { degrees: 42 });
  assert.equal(got, 42);
  m.removeListener("rotate", fn);
  dev.emit("rotate", { degrees: 99 });
  assert.equal(got, 42);
});

test("every call returns a promise that settles, never one that waits on hub feedback", async () => {
  const { m } = setup(0);
  await m.setPower(10);
  await m.brake();
  await m.gotoAngle(0, 40);
  await m.resetZero();
});

test("a write whose acknowledgement never comes still settles, so awaiting cannot hang", async () => {
  const hub = new FakeHub();
  hub.send = () => new Promise(() => {});      // the lost-callback case
  const m = rawMotor(new FakeDevice(hub, 0));
  const t = Date.now();
  await m.brake();
  assert.ok(Date.now() - t < 1000, "settled by the ack timeout");
});

test("setSpeed writes a proper LWP3 StartSpeed (0x07) with profile bits", () => {
  const { hub, m } = setup(3);
  m.setSpeed(30, { maxPower: 50 });
  // 0x07, speed 30, maxPower 50, profile 0x03
  assert.equal(hex(hub.writes[0]), "810311" + "07" + "1e" + "32" + "03");
});

test("legoinoTachoSpeed reproduces Legoino's setTachoMotorSpeed bytes exactly, including sub-command 0x01", () => {
  const { hub, m } = setup(3);
  m.legoinoTachoSpeed(30, { maxPower: 50 });
  // Legoino: {0x81, port, 0x11, 0x01, MapSpeed(speed), maxPower, brakingStyle, 0x03}
  assert.equal(hex(hub.writes[0]), "810311" + "01" + "1e" + "32" + "7f" + "03");
});

test("legoinoStopTacho reproduces Legoino's stopTachoMotor bytes exactly", () => {
  const { hub, m } = setup(0);
  m.legoinoStopTacho();
  assert.equal(hex(hub.writes[0]), "810011" + "01" + "00" + "64" + "7f" + "03");
});

test("legoinoTachoSpeed encodes negative speed as two's complement like the rest of the API", () => {
  const { hub, m } = setup(3);
  m.legoinoTachoSpeed(-30, { maxPower: 50 });
  assert.equal(hex(hub.writes[0]), "810311" + "01" + "e2" + "32" + "7f" + "03");
});
