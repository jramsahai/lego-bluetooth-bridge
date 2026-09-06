import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { sweep } from "../src/sweep.js";

// A LEGO motor as node-poweredup actually presents it: "rotate" is a CHANGE
// notification. Once the motor stalls against an end stop the position stops
// changing, so the events stop entirely. Verified against the real 42160:
// 16 events over 807ms of travel, then 2193ms of total silence while stalled.
class FakeMotor extends EventEmitter {
  constructor({ startDeg = 0, degPerTick = -18, tickMs = 50, ticksBeforeStall = 15 } = {}) {
    super();
    this.deg = startDeg;
    this.ticks = 0;
    this.braked = false;
    this.timer = null;
    this.degPerTick = degPerTick;
    this.tickMs = tickMs;
    this.ticksBeforeStall = ticksBeforeStall;
    // The subscription delivers one reading shortly after we attach.
    this.initial = setTimeout(() => this.emit("rotate", { degrees: this.deg }), 20);
  }
  setPower() {
    this.timer = setInterval(() => {
      if (this.ticks >= this.ticksBeforeStall) return;   // stalled: emit NOTHING
      this.ticks++;
      this.deg += this.degPerTick;
      this.emit("rotate", { degrees: this.deg });
    }, this.tickMs);
  }
  brake() {
    this.braked = true;
    clearInterval(this.timer);
    clearTimeout(this.initial);
  }
}

test("detects a stall even though the motor goes silent when it stops moving", async () => {
  const motor = new FakeMotor({ ticksBeforeStall: 15 });
  const stopPos = await sweep(motor, -30, { timeoutMs: 3000, portName: "D" });
  assert.equal(stopPos, -270, "should report the position it stalled at");
  assert.equal(motor.braked, true, "must always stop the motor");
});

test("detects a stall when the motor never moves at all (already against the stop)", async () => {
  const motor = new FakeMotor({ startDeg: -231, ticksBeforeStall: 0 });
  const stopPos = await sweep(motor, -30, { timeoutMs: 3000, portName: "D" });
  assert.equal(stopPos, -231, "a motor already at its stop is stalled where it sits");
  assert.equal(motor.braked, true);
});

test("still times out on a drive motor that spins forever", async () => {
  const motor = new FakeMotor({ ticksBeforeStall: Infinity });
  await assert.rejects(
    () => sweep(motor, 30, { timeoutMs: 900, portName: "A" }),
    /never stalled/,
    "a motor that keeps turning must not be mistaken for a stall"
  );
  assert.equal(motor.braked, true, "must stop the motor even on the timeout path");
});

test("does not false-stall on the stationary moment before the motor spins up", async () => {
  // Real trace: power commanded at t=0, first movement not seen until ~133ms.
  // Without a dead time the pre-motion samples look exactly like a stall.
  const motor = new FakeMotor({ ticksBeforeStall: 15, tickMs: 50 });
  const stopPos = await sweep(motor, -30, { timeoutMs: 3000, portName: "D" });
  assert.notEqual(stopPos, 0, "must not report the start position as an end stop");
});
