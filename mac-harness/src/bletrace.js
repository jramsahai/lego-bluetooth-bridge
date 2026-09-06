// Raw BLE tracer for node-poweredup. Logs every byte written to the hub,
// when the write's ATT response comes back, every notification the hub sends,
// and the state of the library's per-port command queue at each step.
//
// The question it answers: when a motor "ignores" a command, was that command
// ever written to Bluetooth at all?
//
//   import { trace } from "./bletrace.js";
//   const tr = trace(hub);           // call right after hub.connect()
//   ...
//   tr.wasWritten(portId, 0x7f)      // did a brake for this port hit BLE?
//   tr.dump()                        // print the whole timeline

const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(6) + "ms";
const hex = (b) => Buffer.from(b).toString("hex").replace(/(..)/g, "$1 ").trim();

const FEEDBACK_BITS = [[0x01, "in-progress"], [0x02, "completed"], [0x04, "DISCARDED"], [0x08, "idle"], [0x10, "busy/full"]];
const describeFeedback = (v) => FEEDBACK_BITS.filter(([m]) => v & m).map(([, n]) => n).join("+") || "0";
const ERRORS = { 1: "ACK", 2: "MACK", 3: "BUFFER_OVERFLOW", 4: "TIMEOUT", 5: "COMMAND_NOT_RECOGNIZED", 6: "INVALID_USE", 7: "OVERCURRENT", 8: "INTERNAL_ERROR" };

export function trace(hub, { quiet = false } = {}) {
  const lines = [];
  const tx = [];   // { t, bytes, ackedAt }
  const log = (s) => { lines.push(s); if (!quiet) process.stdout.write(s + "\n"); };

  const queueState = (portId) => {
    const d = hub._getDeviceByPortId(portId);
    if (!d) return "";
    return `queue[${d.portName}] bufLen=${d._bufferLength} transmitted=${d._transmittedPortOutputCommands.length} next=${d._nextPortOutputCommands.length}`;
  };

  // --- outgoing: wrap the BLE write, which is the very last hop in the library
  const ble = hub._bleDevice;
  const origWrite = ble.writeToCharacteristic.bind(ble);
  ble.writeToCharacteristic = (uuid, data) => {
    const rec = { t: Date.now(), bytes: Buffer.from(data), ackedAt: null };
    tx.push(rec);
    let what = "";
    if (data[2] === 0x81) {
      const port = data[3], flags = data[4], sub = data[5];
      what = ` PORT_OUTPUT port=${port} flags=0x${flags.toString(16)} sub=0x${sub.toString(16)}`;
      if (sub === 0x51) what += ` mode=${data[6]} value=${data.readInt8(7)}`;
      what += `  ${queueState(port)}`;
    } else if (data[2] === 0x41) {
      what = ` INPUT_FORMAT_SETUP port=${data[3]} mode=${data[4]} notify=${data[9]}`;
    }
    log(`${ts()} TX  ${hex(data)}${what}`);
    return origWrite(uuid, data).then(
      (r) => { rec.ackedAt = Date.now(); log(`${ts()}  ack write ${hex(data.slice(2))} after ${rec.ackedAt - rec.t}ms`); return r; },
      (e) => { log(`${ts()}  WRITE FAILED ${hex(data)}: ${e && e.message}`); throw e; }
    );
  };

  // --- incoming: wrap the parser so we see every complete message
  const origParse = hub._parseMessage.bind(hub);
  hub._parseMessage = function (data) {
    if (data) {
      // Split exactly the way the library will, so each message is logged once.
      let buf = Buffer.concat([this._messageBuffer, data]);
      // Only log the complete messages that this chunk completes.
      let off = 0;
      while (off < buf.length && buf[off] <= buf.length - off) {
        const m = buf.slice(off, off + buf[off]);
        off += buf[off];
        const type = m[2];
        if (type === 0x82) {
          const parts = [];
          for (let i = 3; i < m.length; i += 2) parts.push(`port=${m[i]} fb=0x${m[i + 1].toString(16)}(${describeFeedback(m[i + 1])})`);
          log(`${ts()} RX  ${hex(m)} FEEDBACK ${parts.join("  ")}  ${parts.map((_, k) => queueState(m[3 + 2 * k])).join("  ")}`);
        } else if (type === 0x05) {
          log(`${ts()} RX  ${hex(m)} !!!! GENERIC ERROR for cmd 0x${m[3].toString(16)}: ${ERRORS[m[4]] || m[4]}`);
        } else if (type === 0x45) {
          // sensor values are noisy; only note them in quiet mode's buffer
          lines.push(`${ts()} RX  ${hex(m)} value port=${m[3]}`);
        } else if (type === 0x47) {
          log(`${ts()} RX  ${hex(m)} INPUT_FORMAT port=${m[3]} mode=${m[4]}`);
        } else if (type === 0x04) {
          log(`${ts()} RX  ${hex(m)} ATTACHED_IO port=${m[3]} event=${m[4]}`);
        } else {
          log(`${ts()} RX  ${hex(m)} type=0x${type.toString(16)}`);
        }
      }
    }
    return origParse(data);
  };

  // --- the library's own bookkeeping, after each feedback is applied
  for (const d of hub.getDevices()) instrumentDevice(d);
  hub.on("attach", instrumentDevice);
  function instrumentDevice(d) {
    if (d.__traced) return;
    d.__traced = true;
    const origFinish = d.finish.bind(d);
    d.finish = (m) => { origFinish(m); log(`${ts()}   after finish: ${queueState(d.portId)}`); };
    const origSend = d.sendPortOutputCommand.bind(d);
    d.sendPortOutputCommand = (data, interrupt) => {
      log(`${ts()} APP ${d.portName}.command ${hex(data)} interrupt=${!!interrupt}  ${queueState(d.portId)}`);
      return origSend(data, interrupt);
    };
  }

  return {
    lines,
    tx,
    mark: (s) => log(`${ts()} --- ${s}`),
    // Was a port-output command with this final value byte written for this port since `sinceMs`?
    wasWritten(portId, value, sinceMs = 0) {
      return tx.some((r) => r.t >= sinceMs && r.bytes[2] === 0x81 && r.bytes[3] === portId && r.bytes[r.bytes.length - 1] === (value & 0xff));
    },
    dump() { for (const l of lines) process.stdout.write(l + "\n"); },
    queueState,
  };
}

// Emergency stop that does not go through the library's per-port queue:
// a raw Port Output Command, WriteDirectModeData mode 0, value 127 = brake.
export function rawBrake(hub, portId) {
  return hub.send(Buffer.from([0x81, portId, 0x11, 0x51, 0x00, 0x7f]), "00001624-1212-efde-1623-785feabcd123");
}
