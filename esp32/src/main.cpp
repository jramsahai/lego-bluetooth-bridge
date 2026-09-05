#include <Arduino.h>
#include "Lpf2Hub.h"
#include "hw_config.h"

Lpf2Hub myHub;
static bool dumped = false;

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

    if (myHub.isConnected() && !dumped) {
        delay(2000);                 // let attach messages arrive
        Serial.println("[ports] device type per port:");
        for (uint8_t p = 0; p < 4; p++) {
            Serial.printf("  port %c (%u): type=%u\n",
                          'A' + p, p, myHub.getDeviceTypeForPortNumber(p));
        }
        dumped = true;
    }

    if (!myHub.isConnected() && !myHub.isConnecting() && dumped) {
        Serial.println("[ble] disconnected, rescanning");
        dumped = false;
        myHub.init();
    }
    delay(50);
}
