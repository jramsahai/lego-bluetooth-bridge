"""Pure tilt shaping and wire framing.

Deliberately imports nothing from `microbit`, so the desktop test suite can
run it. All hardware access lives in main.py.
"""

EXPO_STEER = 0.6
EXPO_THROTTLE = 0.3
DEADZONE = 0.08
FULL_SCALE = 700  # milli-g at ~45 degrees of tilt


def shape_axis(raw, expo, deadzone=DEADZONE, full_scale=FULL_SCALE):
    """Milli-g delta from neutral -> integer -100..100.

    Clamp, then deadzone (rescaled so output resumes from zero rather than
    jumping), then an expo curve for fine control near center.
    """
    n = raw / float(full_scale)
    if n > 1.0:
        n = 1.0
    elif n < -1.0:
        n = -1.0

    magnitude = abs(n)
    if magnitude < deadzone:
        shaped = 0.0
    else:
        shaped = (magnitude - deadzone) / (1.0 - deadzone)
        if n < 0:
            shaped = -shaped

    out = expo * (shaped ** 3) + (1.0 - expo) * shaped
    return int(round(out * 100))


def xor_checksum(body):
    c = 0
    for ch in body:
        c ^= ord(ch)
    return "%02X" % c


def build_frame(steer, throttle, flags):
    body = "%d,%d,%d" % (steer, throttle, flags)
    return "!%s*%s\n" % (body, xor_checksum(body))


def decode_status(byte):
    """Wire byte from the ESP32 -> status 0..9, or -1 if it isn't one.

    The ESP32 sends its status as the ASCII digit '0'..'7', not as the raw
    value: after main.py's uart.init(tx=pin0, rx=pin1) this UART is also
    MicroPython's console, and a raw 0x03 (CALIBRATING) is Ctrl-C there,
    which raises KeyboardInterrupt inside main.py and silently ends it
    (docs/OPEN-ISSUE-microbit-freeze.md). Anything outside '0'..'9' is not
    a status; -1 keeps it out of main.py's icon table so it shows as SAD.
    """
    d = byte - 48  # ord("0")
    if 0 <= d <= 9:
        return d
    return -1
