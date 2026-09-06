// Motor commands written straight to the hub, bypassing node-poweredup's
// per-port command queue.
//
// Why: node-poweredup 10.x only moves a command out of a port's queue when the
// promise from the BLE write resolves. The BLE layer (@stoprocent/noble)
// registers each write's completion callback with onceExclusive(), which
// REMOVES the previous pending callback. So when a second write to the hub -
// to any port - is issued before the first write's acknowledgement comes back
// (about 50-65 ms on this Mac), the first write's promise never resolves, that
// command sits at the head of its port's queue forever, and the library never
// writes another command for that port. That is the "port A ignores its
// commanded power for the rest of the session" fault (docs/OPEN-ISSUE-port-a.md),
// observed byte-for-byte with `npm run trace` and reproduced without hardware
// in test/poweredup-queue.test.js.
//
// The bytes below are exactly what Legoino sends from the ESP32
// (setBasicMotorSpeed / setAbsoluteMotorPosition / setAbsoluteMotorEncoderPosition),
// so the Mac harness now exercises the same wire pattern as the firmware.
import * as Consts from "node-poweredup/dist/consts.js";

const LPF2_ALL = Consts.BLECharacteristic.LPF2_ALL;
// Startup and Completion byte: 0x1_ = execute immediately, _1 = send feedback.
// Same value Legoino uses. Feedback is harmless here; nothing waits on it.
const EXECUTE_IMMEDIATELY = 0x11;
// The write acknowledgement can be lost to the noble behaviour above whenever
// two writes overlap, so no caller may ever be left waiting on one.
const ACK_TIMEOUT_MS = 300;

const clampSpeed = (s) => (s === 127 ? 127 : Math.max(-100, Math.min(100, Math.round(s))));

export function rawMotor(device) {
  const hub = device.hub;
  const portId = device.portId;

  // hub.send prepends the two-byte LWP3 header (length, hub id). The bytes are
  // handed to CoreBluetooth immediately; the returned promise settles on the
  // acknowledgement or after ACK_TIMEOUT_MS, whichever is first, so it is
  // always safe to await.
  const portOutput = (payload) => {
    const written = hub.send(Buffer.from([0x81, portId, EXECUTE_IMMEDIATELY, ...payload]), LPF2_ALL);
    const timeout = new Promise((resolve) => setTimeout(resolve, ACK_TIMEOUT_MS));
    return Promise.race([written, timeout]);
  };

  return {
    get portId() { return portId; },
    get portName() { return device.portName; },
    get device() { return device; },

    /** StartPower via WriteDirectModeData mode 0. -100..100, 0 = float, 127 = brake. */
    setPower(power) {
      return portOutput([0x51, 0x00, clampSpeed(power) & 0xff]);
    },
    brake() { return this.setPower(Consts.BrakingStyle.BRAKE); },
    stop() { return this.setPower(0); },

    /** StartSpeed (0x07): speed-regulated, the LWP3 command Legoino's setTachoMotorSpeed was presumably meant to send. */
    setSpeed(speed, { maxPower = 100 } = {}) {
      return portOutput([0x07, clampSpeed(speed) & 0xff, maxPower, 0x03]);
    },

    /**
     * Byte-for-byte what Legoino's setTachoMotorSpeed sends from the ESP32:
     *   {0x81, port, 0x11, 0x01, MapSpeed(speed), maxPower, brakingStyle, 0x03}
     * Sub-command 0x01 is StartPower(Power) in LWP3, which takes ONE byte; the
     * three trailing bytes are not part of that command. This exists so the
     * harness can find out what the hub does with it before the firmware
     * relies on it. Not for driving.
     */
    legoinoTachoSpeed(speed, { maxPower = 100, brakeStyle = Consts.BrakingStyle.BRAKE } = {}) {
      return portOutput([0x01, clampSpeed(speed) & 0xff, maxPower, brakeStyle, 0x03]);
    },
    /** Byte-for-byte what Legoino's stopTachoMotor sends: setTachoMotorSpeed(port, 0). */
    legoinoStopTacho() { return this.legoinoTachoSpeed(0); },

    /** GotoAbsolutePosition. Matches node-poweredup's defaults: max power 100, BRAKE, accel+decel profile. */
    gotoAngle(angle, speed = 100, { maxPower = 100, brakeStyle = Consts.BrakingStyle.BRAKE } = {}) {
      const msg = Buffer.from([0x0d, 0, 0, 0, 0, clampSpeed(speed) & 0xff, maxPower, brakeStyle, 0x03]);
      msg.writeInt32LE(Math.round(angle), 1);
      return portOutput(msg);
    },

    /** PresetEncoder: make the current position read as zero. */
    resetZero() { return portOutput([0x51, 0x02, 0x00, 0x00, 0x00, 0x00]); },

    // Position notifications still come from the library's device object,
    // which subscribes to the encoder the first time a "rotate" listener is added.
    on(event, fn) { device.on(event, fn); return this; },
    once(event, fn) { device.once(event, fn); return this; },
    off(event, fn) { device.removeListener(event, fn); return this; },
    removeListener(event, fn) { device.removeListener(event, fn); return this; },
  };
}
