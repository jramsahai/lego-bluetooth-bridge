import pytest
from shaping import shape_axis, xor_checksum, build_frame, EXPO_STEER, EXPO_THROTTLE


def test_neutral_is_zero():
    assert shape_axis(0, EXPO_STEER) == 0


def test_inside_the_deadzone_is_zero():
    # 50/700 = 0.071, inside the 0.08 deadzone.
    assert shape_axis(50, EXPO_STEER) == 0
    # 56/700 = 0.08 exactly, the boundary.
    assert shape_axis(56, EXPO_STEER) == 0


def test_full_deflection_saturates():
    assert shape_axis(700, EXPO_STEER) == 100
    assert shape_axis(-700, EXPO_STEER) == -100


def test_beyond_full_deflection_clamps():
    assert shape_axis(900, EXPO_STEER) == 100
    assert shape_axis(-900, EXPO_STEER) == -100


def test_expo_softens_the_middle():
    # Half deflection yields well under half output, and steering (more expo)
    # is softer than throttle.
    assert shape_axis(350, EXPO_STEER) == 24
    assert shape_axis(350, EXPO_THROTTLE) == 35


def test_shaping_is_symmetric():
    assert shape_axis(-350, EXPO_STEER) == -24
    assert shape_axis(-350, EXPO_THROTTLE) == -35


def test_checksum_matches_the_spec_example():
    assert xor_checksum("-42,80,1") == "12"


def test_build_frame_matches_the_spec_example():
    assert build_frame(-42, 80, 1) == "!-42,80,1*12\n"


def test_build_frame_zeroes():
    assert build_frame(0, 0, 0) == "!0,0,0*30\n"


@pytest.mark.parametrize("steer,throttle,flags", [
    (0, 0, 0), (100, -100, 3), (-100, 100, 1), (13, -7, 2), (-42, 80, 1),
])
def test_built_frames_round_trip_through_a_reference_parser(steer, throttle, flags):
    """Mirror of the ESP32 parser in Task 5. If this drifts, the two halves
    of the wire protocol have diverged."""
    line = build_frame(steer, throttle, flags).strip()
    assert line.startswith("!")
    body, _, cksum = line[1:].partition("*")
    assert xor_checksum(body) == cksum
    s, t, f = (int(x) for x in body.split(","))
    assert (s, t, f) == (steer, throttle, flags)
    assert -100 <= s <= 100 and -100 <= t <= 100 and 0 <= f <= 255
