import { test } from "node:test";
import assert from "node:assert/strict";
import { isStalled, computeSteeringRange, steerToPosition } from "../src/steering-math.js";

test("computeSteeringRange centers and applies the 10% margin", () => {
  assert.deepEqual(computeSteeringRange(-100, 40), { center: -30, halfRange: 63 });
});

test("computeSteeringRange rejects a sweep that did not move", () => {
  assert.throws(() => computeSteeringRange(50, 50), /invalid sweep/);
  assert.throws(() => computeSteeringRange(50, 10), /invalid sweep/);
});

test("steerToPosition maps full deflection to the range ends", () => {
  assert.equal(steerToPosition(100, 63), 63);
  assert.equal(steerToPosition(-100, 63), -63);
  assert.equal(steerToPosition(0, 63), 0);
});

test("steerToPosition is proportional in between", () => {
  assert.equal(steerToPosition(50, 63), 32);
});

test("steerToPosition clamps out-of-range input rather than exceeding the stops", () => {
  assert.equal(steerToPosition(150, 63), 63);
  assert.equal(steerToPosition(-150, 63), -63);
});

test("isStalled is true when a full window of samples barely moves", () => {
  const samples = [
    { t: 0, deg: 100 }, { t: 50, deg: 101 },
    { t: 100, deg: 100 }, { t: 160, deg: 101 },
  ];
  assert.equal(isStalled(samples), true);
});

test("isStalled is false while the motor is still turning", () => {
  const samples = [
    { t: 0, deg: 100 }, { t: 50, deg: 120 },
    { t: 100, deg: 140 }, { t: 160, deg: 160 },
  ];
  assert.equal(isStalled(samples), false);
});

test("isStalled is false before a full window has elapsed", () => {
  const samples = [{ t: 0, deg: 100 }, { t: 60, deg: 100 }];
  assert.equal(isStalled(samples), false);
});

test("isStalled is false with no samples at all", () => {
  assert.equal(isStalled([]), false);
});
