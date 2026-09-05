#include "protocol.h"
#include <stdlib.h>
#include <string.h>

uint8_t xorChecksum(const char *body, size_t len) {
    uint8_t c = 0;
    for (size_t i = 0; i < len; i++) {
        c ^= (uint8_t)body[i];
    }
    return c;
}

// Uppercase only: the spec fixes the wire format as uppercase hex, and
// accepting lowercase too would silently widen the contract.
static bool hexNibble(char ch, uint8_t *out) {
    if (ch >= '0' && ch <= '9') { *out = (uint8_t)(ch - '0'); return true; }
    if (ch >= 'A' && ch <= 'F') { *out = (uint8_t)(ch - 'A' + 10); return true; }
    return false;
}

bool parseFrame(const char *line, Frame *out) {
    if (line == NULL || out == NULL) return false;
    if (line[0] != '!') return false;

    const char *star = strchr(line, '*');
    if (star == NULL) return false;

    const char *body = line + 1;
    size_t bodyLen = (size_t)(star - body);
    if (bodyLen == 0) return false;

    uint8_t hi, lo;
    if (!hexNibble(star[1], &hi)) return false;
    if (!hexNibble(star[2], &lo)) return false;
    if (xorChecksum(body, bodyLen) != (uint8_t)((hi << 4) | lo)) return false;

    long vals[3];
    const char *p = body;
    for (int i = 0; i < 3; i++) {
        char *end = NULL;
        vals[i] = strtol(p, &end, 10);
        if (end == p) return false;          // no digits consumed
        p = end;
        if (i < 2) {
            if (*p != ',') return false;
            p++;
        }
    }
    if (p != star) return false;             // junk between last field and '*'

    if (vals[0] < -100 || vals[0] > 100) return false;
    if (vals[1] < -100 || vals[1] > 100) return false;
    if (vals[2] < 0 || vals[2] > 255) return false;

    out->steer = (int)vals[0];
    out->throttle = (int)vals[1];
    out->flags = (uint8_t)vals[2];
    return true;
}
