# Issues found in third-party libraries

Found while bringing up this project against a LEGO Technic Hub 88012 (set
42160) on 2026-09-05 and 2026-09-06. Each section is written to stand alone as
an upstream bug report. Versions are the ones installed in this repository.

| Library | Version | Issues |
|---------|---------|--------|
| [node-poweredup](https://github.com/nathankellenicki/node-poweredup) | 10.1.0 | 1. Port output queue wedges permanently after one lost write acknowledgement |
| [@stoprocent/noble](https://github.com/stoprocent/noble) | 2.8.0 | 2. Overlapping writes on one characteristic drop the earlier write's callback |
| [Legoino](https://github.com/corneliusmunz/legoino) | 1.1.0 | 3. `setTachoMotorSpeed` sends sub-command `0x01`, not StartSpeed; 4. `MapSpeed` rescales power outside the protocol's range; 5. Unbounded NimBLE-Arduino dependency no longer compiles |

Issues 1 and 2 combine into one user-visible fault, which is how they were
found: a motor port silently stops accepting commands for the rest of the
session. The full investigation is in `docs/OPEN-ISSUE-port-a.md`.

---

## 1. node-poweredup 10.1.0: a port's command queue wedges permanently if a write promise never resolves

**Suggested title:** Device port output queue never recovers when `hub.send()` does not resolve; all later commands for that port are silently dropped

**Where:** `src/devices/device.ts` (`dist/devices/device.js`), `transmitNextPortOutputCommand`.

**What happens.** `sendPortOutputCommand` pushes a `PortOutputCommand` onto `_nextPortOutputCommands` and calls `transmitNextPortOutputCommand`, which marks the head command `TRANSMISSION_BUSY`, calls `this.send(...)`, and only inside `send(...).then(...)` shifts the command off the queue and into `_transmittedPortOutputCommands`:

```js
nextCommand.state = Consts.CommandFeedback.TRANSMISSION_BUSY;
this.send(Buffer.concat([Buffer.from([0x81, this.portId, nextCommand.startupAndCompletion]), nextCommand.data])).then(() => {
    if (nextCommand.state !== Consts.CommandFeedback.TRANSMISSION_BUSY) return;
    const command = this._nextPortOutputCommands.shift();
    if (command instanceof PortOutputCommand) this._transmittedPortOutputCommands.push(command);
});
```

If that promise never resolves, the command stays at the head of
`_nextPortOutputCommands` in `TRANSMISSION_BUSY` forever. Every later
`transmitNextPortOutputCommand` call finds a head that is not
`TRANSMISSION_PENDING` and returns without sending. `sendPortOutputCommand`
with `interrupt = true` (what `brake()` and `stop()` use) explicitly keeps
`TRANSMISSION_BUSY` commands when it discards the queue, so it cannot clear
it either. From then on every `setPower`, `setSpeed`, `brake` etc. for that
port is queued and never written to Bluetooth, and its returned promise never
settles. Other ports are unaffected. Nothing is logged.

The promise does fail to resolve in practice: see issue 2 below. On macOS
with `@stoprocent/noble` 2.8.0, issuing a write for port B within the ~50-65
ms it takes port A's write to be acknowledged loses A's callback, so
commanding two motors within about 50 ms of each other wedges the first one.

**A second, independent way to wedge the same queue.** If the hub's Port
Output Command Feedback (0x82) for a command is delivered before the write
promise resolves, `finish()` runs with `_transmittedPortOutputCommands` empty,
sets `_bufferLength` from the feedback (0 for `0x0A`), and then the late
`.then` pushes the command into `_transmittedPortOutputCommands`. Now
`_bufferLength (0) !== _transmittedPortOutputCommands.length (1)` and the
guard at the top of `transmitNextPortOutputCommand` returns forever, since the
only thing that could reconcile the two is more feedback, which needs a write.

**Reproduction without hardware.** `mac-harness/test/poweredup-queue.test.js`
in this repository drives the real `TechnicLargeLinearMotor` class from
10.1.0 with a fake hub whose `send()` promise and `finish()` calls are
controlled. It shows: (a) dropping the first write's resolution leaves every
later command for that port unwritten while another port keeps working;
(b) feedback-before-resolution wedges the port; (c) a raw `hub.send()` of the
same bytes still gets through.

**Observed on hardware.** With every BLE byte logged
(`mac-harness/src/tracetest.js`): port A `setPower(30)` written; port B
`setPower(30)` written 40 ms later; one acknowledgement arrives 53 ms after
A's write; A's later `setPower(70)` and `brake()` are logged by the
application and never appear on the wire; port B's do. The motor keeps
running at its last power until the hub is power-cycled.

**Suggested fix.** Move the command into `_transmittedPortOutputCommands` when
the write is *issued*, not when it resolves, so a lost or late resolution
cannot strand it; and reject or time out a `TRANSMISSION_BUSY` command whose
`send()` has not settled within a bound (a few connection intervals), so the
queue can advance. Also re-derive `_bufferLength` from each feedback rather
than refusing to transmit when it disagrees with the local count.

---

## 2. @stoprocent/noble 2.8.0: overlapping writes on the same characteristic lose the earlier write's callback

**Suggested title:** `Characteristic.write()` with a callback uses `onceExclusive('write')`, so a second write before the first completes drops the first callback; `writeAsync` never settles

**Where:** `lib/characteristic.js` `write()`, `lib/noble-event-emitter.js` `onceExclusive()`.

**What happens.**

```js
// characteristic.js
write (data, withoutResponse, callback) {
  ...
  if (callback) {
    this.onceExclusive('write', error => callback(error));
  }
  this._noble.write(this._peripheralId, this._serviceUuid, this.uuid, data, withoutResponse);
}

// noble-event-emitter.js
onceExclusive (event, callback) {
  ...
  const prev = this._exclusiveCallbacks.get(event);
  if (prev) {
    this.removeListener(event, prev);     // <- the earlier write's callback is discarded
  }
  ...
  this.once(event, wrappedCallback);
}
```

`onceExclusive` is documented as preventing listener accumulation "when a
method is called repeatedly before the event fires". For `write` that is
exactly the case where two callbacks are both owed: two writes are in flight,
two `write` events will arrive, and the first should go to the first caller.
Instead the first caller's listener is removed, its callback (and
`writeAsync` promise) never fires, and the first `write` event is delivered
to the *second* caller, whose write has not actually been acknowledged yet.
The second event then finds no listener. The data itself is still written
(the peripheral executed both commands in our traces); only the completion
bookkeeping is wrong.

**When it bites.** Any client that writes to one characteristic from more
than one logical source without serialising, which is the normal shape of a
robotics or IoT protocol where several devices share a channel. In LEGO
Wireless Protocol every port shares one characteristic. A write-with-response
round trip on macOS was measured at 49-64 ms, so two writes less than ~50 ms
apart are enough.

**Observed.** `mac-harness/src/tracetest.js` output, 2026-09-05: two writes
40 ms apart, one acknowledgement 53 ms after the first write (i.e. the
first's), reported to the second write's callback 11 ms after it was issued;
the first write's promise never resolved.

**Suggested fix.** Either queue writes-with-response per characteristic
(issue the next only after the previous `write` event), which is what the ATT
layer does anyway, or keep a FIFO of pending callbacks per characteristic and
pop one per `write` event, so each completion reaches the caller that owes
it. `onceExclusive` is right for idempotent state requests such as
`notify` or `discover`; it is wrong for `write`.

---

## 3. Legoino 1.1.0: `setTachoMotorSpeed` sends sub-command `0x01`, which is not StartSpeed

**Suggested title:** `setTachoMotorSpeed` / `stopTachoMotor` emit Port Output sub-command `0x01` (StartPower, 1 byte) with a 4-byte StartSpeed payload

**Where:** `src/Lpf2Hub.cpp` line 1231:

```cpp
byte setMotorCommand[8] = {0x81, port, 0x11, 0x01, LegoinoCommon::MapSpeed(speed), maxPower, (byte)brakingStyle, 0x03};
```

**What the protocol says.** In LEGO Wireless Protocol 3.0, Port Output
Command sub-commands are `0x01` StartPower(Power) with a single power byte,
`0x07` StartSpeed(Speed, MaxPower, UseProfile), and so on. The payload
Legoino builds (`speed, maxPower, brakingStyle, profile`) is the shape of a
StartSpeed-family command, but the sub-command byte says StartPower. The
bytes `maxPower`, `brakingStyle`, `0x03` are therefore not part of any
command the hub is being asked to run, and `brakingStyle` in particular has
no effect: `stopTachoMotor` believes it is stopping with `BrakingStyle::BRAKE`
but is sending StartPower with power byte 127 (see issue 4), which the hub
happens to treat as brake.

**Measured behaviour on Technic Hub 88012** (`mac-harness/src/firmwarecmds.js`,
2026-09-06): the hub accepted the 8-byte message with no Generic Error,
treated the first payload byte as power (speed 30 → byte 37 drove the motor
to its end stop; `stopTachoMotor`'s byte 127 stopped two running motors), and
ignored the trailing bytes. So the function works on this hub by accident:
speed regulation, max power and braking style are not applied. Other hubs or
firmware versions may reject the malformed length.

**Suggested fix.** Use sub-command `0x07` for `setTachoMotorSpeed`:
`{0x81, port, 0x11, 0x07, speed, maxPower, useProfile}` (StartSpeed carries no
end-state byte; braking style applies to the positional commands `0x09`,
`0x0B`, `0x0D`). For `stopTachoMotor`, send StartPower with 127 (brake) or
126 (hold) explicitly via `0x51 0x00`, which is what the hub is currently
receiving.

---

## 4. Legoino 1.1.0: `MapSpeed` rescales every power/speed argument outside the protocol's defined range

**Suggested title:** `LegoinoCommon::MapSpeed` maps 1..100 onto 1..126 and 0 onto 127, so full speed sends 126 and "stop" sends the brake sentinel

**Where:** `src/LegoinoCommon.cpp` line 17:

```cpp
byte LegoinoCommon::MapSpeed(int speed) {
    byte rawSpeed;
    if (speed == 0)      rawSpeed = 127;                        // "stop motor"
    else if (speed > 0)  rawSpeed = map(speed, 0, 100, 0, 126);
    else                 rawSpeed = map(-speed, 0, 100, 255, 128);
    return rawSpeed;
}
```

Every motor helper (`setBasicMotorSpeed`, `setTachoMotorSpeed`,
`setAbsoluteMotorPosition`, `setTachoMotorSpeedForTime`, ...) passes its
speed argument through this.

**What the protocol says.** Power and speed are signed 8-bit percentages,
-100..100. In StartPower, 127 means brake and 126 means hold; there is no
defined meaning for 101..125.

**Consequences.**

- `setBasicMotorSpeed(port, 100)` puts **126** on the wire, which is the hold
  sentinel for StartPower, not full power. What a hub does with it is
  undefined (we did not measure it), and the mapping means no caller can ever
  send 100.
- `setBasicMotorSpeed(port, 0)` sends **127**, so `stopBasicMotor` is an
  active brake rather than the float (0) the name and comment suggest. That is
  the safer behaviour, but it is undocumented and it is why `stopTachoMotor`
  (issue 3) stops at all.
- Negative speeds map onto 255..128, i.e. int8 -1..-128, so -100 sends -128,
  again outside the defined range.
- A caller cannot pass the brake or hold sentinels deliberately:
  `MapSpeed(127)` is `127 * 126 / 100 = 160`, which as int8 is **-96**, nearly
  full reverse. A user who reads the protocol and calls
  `setBasicMotorSpeed(port, 127)` to brake drives the motor backwards. We
  nearly shipped exactly that.

**Suggested fix.** Clamp to -100..100 and send the value as-is; provide
explicit `brake(port)` (127) and `hold(port)` (126) helpers; make "0" mean
float as the protocol does, or document that it brakes.

---

## 5. Legoino 1.1.0: `depends=NimBLE-Arduino` with no version bound no longer compiles

**Suggested title:** Fresh installs resolve NimBLE-Arduino 2.x and Legoino fails to build

**Where:** `library.properties` `depends=NimBLE-Arduino` (and the equivalent
in `library.json`).

**What happens.** With PlatformIO Core 6.2.0 and the `espressif32` platform
(7.1.1), `lib_deps = corneliusmunz/Legoino` resolves NimBLE-Arduino 2.5.1.
Legoino's own sources then fail to compile against it:
`NimBLEDevice::getClientListSize` no longer exists, `setScanResponse` was
renamed, `setPower` changed its parameter types, and the
`NimBLEAddress(std::string)` / `NimBLEAdvertisementData::addData(std::string)`
overloads were removed in NimBLE-Arduino 2.0.

**Workaround used here.** Pin the 1.x line in `platformio.ini`:

```ini
lib_deps =
    h2zero/NimBLE-Arduino@^1.4.2
    corneliusmunz/Legoino@^1.1.0
```

With that, Legoino 1.1.0 builds cleanly against NimBLE-Arduino 1.4.3.

**Suggested fix.** Declare `depends=NimBLE-Arduino (<2.0.0)` (or the
`library.json` equivalent) until the library is ported to the 2.x API.

---

## What this project did about each

- Issues 1 and 2: the Mac harness bypasses node-poweredup's queue and writes
  each Port Output Command directly (`mac-harness/src/rawmotor.js`); the
  returned promise settles on acknowledgement or a 300 ms timeout so a lost
  callback cannot hang a caller.
- Issues 3 and 4: the ESP32 firmware no longer uses any Legoino motor helper
  for output. `esp32/lib/ctrl/lwp3.cpp` builds StartPower, GotoAbsolutePosition
  and PresetEncoder byte by byte and writes them with Legoino's public
  `WriteValue`; native tests pin those bytes to the harness's test vectors.
- Issue 5: pinned as above.
