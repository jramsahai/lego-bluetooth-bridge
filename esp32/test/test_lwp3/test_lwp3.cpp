#include <unity.h>
#include <string.h>
#include "lwp3.h"

void setUp(void) {}
void tearDown(void) {}

// Every vector below is copied from mac-harness/test/rawmotor.test.js, which
// is what the Mac harness has sent to the real car. Keep the two in lockstep.

void test_start_power_matches_the_harness(void) {
    uint8_t out[6];
    TEST_ASSERT_EQUAL_size_t(6, lwp3StartPower(0, 30, out));
    const uint8_t want[6] = {0x81, 0x00, 0x11, 0x51, 0x00, 0x1e};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, out, 6);
}

void test_start_power_negative_is_twos_complement(void) {
    uint8_t out[6];
    lwp3StartPower(1, -70, out);
    const uint8_t want[6] = {0x81, 0x01, 0x11, 0x51, 0x00, 0xba};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, out, 6);
}

void test_start_power_brake_is_127_unscaled(void) {
    uint8_t out[6];
    lwp3StartPower(1, LWP3_POWER_BRAKE, out);
    const uint8_t want[6] = {0x81, 0x01, 0x11, 0x51, 0x00, 0x7f};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, out, 6);
}

void test_start_power_clamps_to_plus_minus_100(void) {
    uint8_t out[6];
    lwp3StartPower(1, 250, out);
    TEST_ASSERT_EQUAL_UINT8(0x64, out[5]);
    lwp3StartPower(1, -250, out);
    TEST_ASSERT_EQUAL_UINT8(0x9c, out[5]);   // -100
}

void test_goto_absolute_matches_the_harness(void) {
    uint8_t out[12];
    TEST_ASSERT_EQUAL_size_t(12, lwp3GotoAbsolute(3, -105, 40, 100, LWP3_BRAKE_STYLE_BRAKE, out));
    // 0x0d, int32 LE -105, speed 40, maxPower 100, BRAKE 127, profile 0x03
    const uint8_t want[12] = {0x81, 0x03, 0x11, 0x0d, 0x97, 0xff, 0xff, 0xff, 0x28, 0x64, 0x7f, 0x03};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, out, 12);
}

void test_goto_absolute_speed_is_not_rescaled_and_is_clamped(void) {
    uint8_t out[12];
    lwp3GotoAbsolute(3, 0, 100, 100, LWP3_BRAKE_STYLE_BRAKE, out);
    TEST_ASSERT_EQUAL_UINT8(0x64, out[8]);   // 100 stays 100, never 126
    lwp3GotoAbsolute(3, 0, 140, 100, LWP3_BRAKE_STYLE_BRAKE, out);
    TEST_ASSERT_EQUAL_UINT8(0x64, out[8]);
}

void test_preset_encoder_matches_the_harness(void) {
    uint8_t out[9];
    TEST_ASSERT_EQUAL_size_t(9, lwp3PresetEncoder(3, 0, out));
    const uint8_t want[9] = {0x81, 0x03, 0x11, 0x51, 0x02, 0x00, 0x00, 0x00, 0x00};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, out, 9);
}

void test_preset_encoder_is_little_endian(void) {
    uint8_t out[9];
    lwp3PresetEncoder(3, -2, out);
    const uint8_t want[4] = {0xfe, 0xff, 0xff, 0xff};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(want, out + 5, 4);
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    UNITY_BEGIN();
    RUN_TEST(test_start_power_matches_the_harness);
    RUN_TEST(test_start_power_negative_is_twos_complement);
    RUN_TEST(test_start_power_brake_is_127_unscaled);
    RUN_TEST(test_start_power_clamps_to_plus_minus_100);
    RUN_TEST(test_goto_absolute_matches_the_harness);
    RUN_TEST(test_goto_absolute_speed_is_not_rescaled_and_is_clamped);
    RUN_TEST(test_preset_encoder_matches_the_harness);
    RUN_TEST(test_preset_encoder_is_little_endian);
    return UNITY_END();
}
