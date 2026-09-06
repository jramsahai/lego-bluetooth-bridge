from microbit import *
from shaping import shape_axis, build_frame, decode_status, EXPO_STEER, EXPO_THROTTLE

FLAG_ARMED = 0x01
FLAG_RECAL = 0x02
PERIOD_MS = 20          # 50 Hz

# Status values from the ESP32, and what to show for each. On the wire
# each arrives as the ASCII digit '0'..'7' (see decode_status for why).
ICONS = {
    0: Image.DIAMOND_SMALL,   # BOOT
    1: Image.DIAMOND,         # BLE_SCANNING
    2: Image.YES,             # CONNECTED
    3: Image.ALL_CLOCKS[0],   # CALIBRATING
    4: Image.SQUARE_SMALL,    # READY_DISARMED
    5: Image.HEART,           # ARMED
    6: Image.NO,              # FAILSAFE
    7: Image.SKULL,           # ERROR
}


def capture_neutral(flags):
    """Average ~20 samples over ~400ms as the new resting orientation.

    Keeps writing frames (steer=0, throttle=0, the given flags) once per
    sample so the ESP32's failsafe timer keeps getting refreshed while we
    are re-zeroing, instead of going silent for the whole capture window.
    Tilt readings during this window are meaningless (the hand is being
    re-zeroed), so steer/throttle are deliberately zeroed, not carried
    over from the caller.
    """
    display.show(Image.TARGET)
    xs, ys = 0, 0
    n = 20
    for _ in range(n):
        xs += accelerometer.get_x()
        ys += accelerometer.get_y()
        uart.write(build_frame(0, 0, flags))
        sleep(20)
    display.clear()
    return xs // n, ys // n


uart.init(baudrate=115200, tx=pin0, rx=pin1)
# From here on, print() goes down the wire, not to USB. Use the display.
# The reverse is also true: whatever the ESP32 sends is this script's
# stdin, and a raw 0x03 there is Ctrl-C (KeyboardInterrupt, script over,
# display frozen). That is why status comes as ASCII digits.

x0, y0 = capture_neutral(0)
have_neutral = True
status = 0

while True:
    start = running_time()

    recal = False
    if button_a.was_pressed():
        armed_flags = FLAG_ARMED if have_neutral else 0
        x0, y0 = capture_neutral(armed_flags)
        have_neutral = True
        recal = True

    steer = shape_axis(accelerometer.get_x() - x0, EXPO_STEER)
    throttle = shape_axis(-(accelerometer.get_y() - y0), EXPO_THROTTLE)

    flags = 0
    if have_neutral:
        flags |= FLAG_ARMED
    if recal:
        flags |= FLAG_RECAL

    uart.write(build_frame(steer, throttle, flags))

    if uart.any():
        data = uart.read()
        if data:
            status = decode_status(data[-1])   # most recent byte wins
    display.show(ICONS.get(status, Image.SAD))

    elapsed = running_time() - start
    if elapsed < PERIOD_MS:
        sleep(PERIOD_MS - elapsed)
