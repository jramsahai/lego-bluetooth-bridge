#include <Arduino.h>
#include "Lpf2Hub.h"
#include "hw_config.h"
#include "control.h"

Lpf2Hub myHub;

static volatile int32_t g_steerPos = 0;
static SteerRange g_range = { 0, 0 };
static bool g_calibrated = false;

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
        if (stallPush(&d, millis(), g_steerPos)) {
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

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\n[boot] scanning for Technic Hub...");
    myHub.init();
}

void loop() {
    if (myHub.isConnecting()) {
        if (myHub.connectHub()) {
            Serial.println("[ble] connected");
        } else {
            Serial.println("[ble] connect failed, rescanning");
            myHub.init();
        }
    }

    if (myHub.isConnected() && !g_calibrated) {
        delay(2000);                                   // let attach settle
        myHub.activatePortDevice(HW_STEER_PORT, steerCallback);
        delay(300);
        g_calibrated = calibrateSteering();
        if (!g_calibrated) {
            Serial.println("[calib] ERROR — staying disarmed");
            delay(3000);
        }
    }

    static uint32_t backoffMs = 500;
    static uint32_t lastAttempt = 0;
    if (!myHub.isConnected() && !myHub.isConnecting()) {
        if (g_calibrated) {
            Serial.println("[ble] disconnected");
            g_calibrated = false;      // the car may come back with a different pose
        }
        if (millis() - lastAttempt >= backoffMs) {
            lastAttempt = millis();
            myHub.init();
            backoffMs = backoffMs < 8000 ? backoffMs * 2 : 8000;
        }
    } else if (myHub.isConnected()) {
        backoffMs = 500;   // up again: the next dropout retries fast
    }
    delay(50);
}
