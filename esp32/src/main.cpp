#include <Arduino.h>
#include "Lpf2Hub.h"
#include "hw_config.h"
#include "control.h"
#include "protocol.h"

Lpf2Hub myHub;

static volatile int32_t g_steerPos = 0;
static SteerRange g_range = { 0, 0 };
static bool g_calibrated = false;

static const uint8_t ST_BOOT = 0, ST_SCANNING = 1, ST_CONNECTED = 2,
                     ST_CALIBRATING = 3, ST_READY_DISARMED = 4,
                     ST_ARMED = 5, ST_FAILSAFE = 6, ST_ERROR = 7;

static uint8_t g_status = ST_BOOT;
static bool g_armed = false;            // the ESP32's own latch
static uint32_t g_lastGoodFrameMs = 0;
static int g_throttleNow = 0;           // slew-limited, what the motors see
static Frame g_frame = { 0, 0, 0 };
static bool g_calibFailed = false;       // distinguishes "still calibrating" from "calibration failed"
static int g_calibAttempts = 0;          // consecutive failed calibration attempts
static bool g_calibLatchedError = false; // 3 failures: stop retrying, stop touching the steer motor
static const int MAX_CALIB_ATTEMPTS = 3;

static char g_line[64];
static size_t g_lineLen = 0;

// Set g_status and push it immediately, rather than waiting for the 5 Hz
// timer — needed around the calibration sweep, which blocks loop() for
// several seconds and would otherwise leave the micro:bit on a stale icon.
static void sendStatus(uint8_t s) {
    g_status = s;
    Serial2.write(g_status);
}

void steerCallback(void *hub, byte portNumber, DeviceType deviceType, uint8_t *pData) {
    (void)portNumber; (void)deviceType;
    Lpf2Hub *h = (Lpf2Hub *)hub;
    g_steerPos = h->parseTachoMotor(pData);
}

// Drive the steering motor at `speed` until it stalls against an end stop.
// Always stops the motor. Returns false on timeout.
static bool sweepToStop(int speed, int32_t *stopPos) {
    StallDetector d;
    stallReset(&d, STALL_WINDOW_MS, STALL_THRESHOLD_DEG);
    uint32_t t0 = millis();
    myHub.setTachoMotorSpeed(HW_STEER_PORT, speed, SWEEP_MAX_POWER);

    while (millis() - t0 < SWEEP_TIMEOUT_MS) {
        delay(20);
        sendStatus(ST_CALIBRATING);   // keep the wire alive across the sweep
        bool stalled = stallPush(&d, millis(), g_steerPos);
        // Ignore stall verdicts for the first 300 ms: BLE write latency plus
        // motor spin-up can otherwise leave the motor still stationary when
        // the 150 ms / 2 degree window is first satisfied, which would read
        // as an end stop before the motor has moved at all. Do not remove
        // this dead time — 300 ms + the 150 ms window still leaves large
        // headroom under the 3000 ms timeout.
        if (stalled && millis() - t0 >= 300) {
            myHub.stopTachoMotor(HW_STEER_PORT);
            *stopPos = g_steerPos;
            delay(300);                    // settle before reversing
            return true;
        }
    }
    myHub.stopTachoMotor(HW_STEER_PORT);
    Serial.printf("[calib] TIMEOUT at speed %d after %ums — wrong port?\n",
                  speed, SWEEP_TIMEOUT_MS);
    return false;
}

bool calibrateSteering() {
    Serial.println("[calib] sweeping for end stops...");
    int32_t stopA = 0, stopB = 0;
    if (!sweepToStop(SWEEP_SPEED, &stopA)) return false;
    Serial.printf("[calib] stop 1 at %d\n", (int)stopA);
    if (!sweepToStop(-SWEEP_SPEED, &stopB)) return false;
    Serial.printf("[calib] stop 2 at %d\n", (int)stopB);

    int32_t lo = stopA < stopB ? stopA : stopB;
    int32_t hi = stopA < stopB ? stopB : stopA;
    if (!computeSteerRange(lo, hi, &g_range)) {
        Serial.println("[calib] FAILED: steering never moved between stops");
        return false;
    }
    Serial.printf("[calib] span %d..%d  center=%d  halfRange=%d\n",
                  (int)lo, (int)hi, (int)g_range.center, (int)g_range.halfRange);

    myHub.setAbsoluteMotorPosition(HW_STEER_PORT, 40, g_range.center, STEER_MAX_POWER);
    delay(800);
    myHub.setAbsoluteMotorEncoderPosition(HW_STEER_PORT, 0);
    Serial.println("[calib] centered and zeroed");
    return true;
}

// Accumulate bytes into g_line; on newline, parse and update on success.
// A frame that fails to parse is dropped WITHOUT refreshing the failsafe
// timer, so a degrading wire decays into a stop rather than into garbage.
static void pumpSerial() {
    while (Serial2.available()) {
        char c = (char)Serial2.read();
        if (c == '\n' || c == '\r') {
            if (g_lineLen > 0) {
                g_line[g_lineLen] = '\0';
                Frame f;
                if (parseFrame(g_line, &f)) {
                    g_frame = f;
                    g_lastGoodFrameMs = millis();
                    if (f.flags & FLAG_RECAL) {
                        // A fresh button press is the only thing that arms us,
                        // and only once calibration has actually succeeded.
                        if (g_calibrated) g_armed = true;
                    }
                    if (!(f.flags & FLAG_ARMED)) g_armed = false;
                }
                g_lineLen = 0;
            }
        } else if (g_lineLen < sizeof(g_line) - 1) {
            g_line[g_lineLen++] = c;
        } else {
            g_lineLen = 0;   // overlong garbage: resynchronize
        }
    }
}

static void applyControl(int steer, int throttle) {
    int s = HW_STEER_INVERT ? -steer : steer;
    myHub.setAbsoluteMotorPosition(HW_STEER_PORT, STEER_SPEED,
                                   steerToPosition(s, g_range.halfRange),
                                   STEER_MAX_POWER);
    for (int i = 0; i < 2; i++) {
        int p = HW_DRIVE_INVERT[i] ? -throttle : throttle;
        myHub.setBasicMotorSpeed(HW_DRIVE_PORTS[i], p);
    }
}

static void stopEverything() {
    g_throttleNow = 0;
    for (int i = 0; i < 2; i++) myHub.stopBasicMotor(HW_DRIVE_PORTS[i]);
    if (g_calibrated) {
        myHub.setAbsoluteMotorPosition(HW_STEER_PORT, 60, 0, STEER_MAX_POWER);
    }
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\n[boot] scanning for Technic Hub...");
    myHub.init();
    Serial2.begin(UART_BAUD, SERIAL_8N1, PIN_UART_RX, PIN_UART_TX);
}

void loop() {
    if (myHub.isConnecting()) {
        if (myHub.connectHub()) {
            Serial.println("[ble] connected");
            sendStatus(ST_CONNECTED);
            g_calibAttempts = 0;         // fresh set of attempts on (re)connect
            g_calibLatchedError = false;
        } else {
            Serial.println("[ble] connect failed, rescanning");
            myHub.init();
        }
    }

    if (myHub.isConnected() && !g_calibrated && !g_calibLatchedError) {
        sendStatus(ST_CALIBRATING);
        delay(2000);                                   // let attach settle
        myHub.activatePortDevice(HW_STEER_PORT, steerCallback);
        delay(300);
        g_calibrated = calibrateSteering();
        g_calibFailed = !g_calibrated;

        // Whatever piled up on the wire during the 5.5-9.4 s blocking sweep
        // (including a stale RECAL press) must not be acted on the instant
        // pumpSerial() next runs — drop it and let the failsafe see the gap.
        while (Serial2.available()) Serial2.read();
        g_lineLen = 0;

        if (!g_calibrated) {
            g_calibAttempts++;
            Serial.println("[calib] ERROR — staying disarmed");
            if (g_calibAttempts >= MAX_CALIB_ATTEMPTS) {
                g_calibLatchedError = true;
                Serial.println("[calib] giving up after 3 failed attempts — "
                                "check HW_STEER_PORT against docs/hardware-map.md");
            } else {
                delay(3000);
            }
        }
    }

    static uint32_t backoffMs = 500;
    static uint32_t lastAttempt = 0;
    if (!myHub.isConnected() && !myHub.isConnecting()) {
        if (g_calibrated) {
            Serial.println("[ble] disconnected");
            g_calibrated = false;      // the car may come back with a different pose
            g_calibFailed = false;
        }
        if (millis() - lastAttempt >= backoffMs) {
            lastAttempt = millis();
            myHub.init();
            backoffMs = backoffMs < 8000 ? backoffMs * 2 : 8000;
        }
    } else if (myHub.isConnected()) {
        backoffMs = 500;   // up again: the next dropout retries fast
    }

    pumpSerial();

    static uint32_t lastTick = 0;
    if (millis() - lastTick >= CONTROL_PERIOD_MS) {
        lastTick = millis();

        if (!myHub.isConnected()) {
            g_armed = false;
            g_status = ST_SCANNING;
        } else if (!g_calibrated) {
            g_status = g_calibFailed ? ST_ERROR : ST_CALIBRATING;
        } else if (millis() - g_lastGoodFrameMs > FRAME_TIMEOUT_MS) {
            if (g_armed || g_status != ST_FAILSAFE) {
                Serial.println("[failsafe] no valid frame — stopping");
            }
            g_armed = false;              // require a fresh press to recover
            g_status = ST_FAILSAFE;
            stopEverything();
        } else if (!g_armed) {
            g_status = ST_READY_DISARMED;
            stopEverything();
        } else {
            g_status = ST_ARMED;
            g_throttleNow = slewLimit(g_throttleNow, g_frame.throttle,
                                      THROTTLE_SLEW_PER_TICK);
            applyControl(g_frame.steer, g_throttleNow);
        }
    }

    static uint32_t lastStatus = 0;
    if (millis() - lastStatus >= STATUS_PERIOD_MS) {
        lastStatus = millis();
        Serial2.write(g_status);
    }

    delay(2);
}
