#include "lwp3.h"

static const uint8_t PORT_OUTPUT_COMMAND   = 0x81;
static const uint8_t EXECUTE_IMMEDIATELY   = 0x11;   // startup: execute immediately, completion: feedback
static const uint8_t SUB_WRITE_DIRECT_MODE = 0x51;
static const uint8_t SUB_GOTO_ABSOLUTE     = 0x0d;
static const uint8_t MODE_POWER            = 0x00;
static const uint8_t MODE_POSITION         = 0x02;

static uint8_t clampInt8(int v) {
    if (v > 100) v = 100;
    if (v < -100) v = -100;
    return (uint8_t)(int8_t)v;   // two's complement on the wire
}

static void putInt32LE(uint8_t *p, int32_t v) {
    uint32_t u = (uint32_t)v;
    p[0] = (uint8_t)(u & 0xff);
    p[1] = (uint8_t)((u >> 8) & 0xff);
    p[2] = (uint8_t)((u >> 16) & 0xff);
    p[3] = (uint8_t)((u >> 24) & 0xff);
}

size_t lwp3StartPower(uint8_t port, int power, uint8_t out[6]) {
    out[0] = PORT_OUTPUT_COMMAND;
    out[1] = port;
    out[2] = EXECUTE_IMMEDIATELY;
    out[3] = SUB_WRITE_DIRECT_MODE;
    out[4] = MODE_POWER;
    out[5] = (power == LWP3_POWER_BRAKE) ? (uint8_t)LWP3_POWER_BRAKE : clampInt8(power);
    return 6;
}

size_t lwp3GotoAbsolute(uint8_t port, int32_t position, int speed, uint8_t maxPower, uint8_t brakeStyle, uint8_t out[12]) {
    out[0] = PORT_OUTPUT_COMMAND;
    out[1] = port;
    out[2] = EXECUTE_IMMEDIATELY;
    out[3] = SUB_GOTO_ABSOLUTE;
    putInt32LE(out + 4, position);
    out[8] = clampInt8(speed);
    out[9] = maxPower;
    out[10] = brakeStyle;
    out[11] = LWP3_PROFILE_ACC_DEC;
    return 12;
}

size_t lwp3PresetEncoder(uint8_t port, int32_t position, uint8_t out[9]) {
    out[0] = PORT_OUTPUT_COMMAND;
    out[1] = port;
    out[2] = EXECUTE_IMMEDIATELY;
    out[3] = SUB_WRITE_DIRECT_MODE;
    out[4] = MODE_POSITION;
    putInt32LE(out + 5, position);
    return 9;
}
