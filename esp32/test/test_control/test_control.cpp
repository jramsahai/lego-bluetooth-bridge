#include <unity.h>
#include "control.h"

void setUp(void) {}
void tearDown(void) {}

void test_compute_range_centers_and_applies_margin(void) {
    SteerRange r;
    TEST_ASSERT_TRUE(computeSteerRange(-100, 40, &r));
    TEST_ASSERT_EQUAL_INT32(-30, r.center);
    TEST_ASSERT_EQUAL_INT32(63, r.halfRange);
}

void test_compute_range_rejects_a_sweep_that_did_not_move(void) {
    SteerRange r;
    TEST_ASSERT_FALSE(computeSteerRange(50, 50, &r));
    TEST_ASSERT_FALSE(computeSteerRange(50, 10, &r));
}

void test_steer_to_position_hits_the_range_ends(void) {
    TEST_ASSERT_EQUAL_INT32(63, steerToPosition(100, 63));
    TEST_ASSERT_EQUAL_INT32(-63, steerToPosition(-100, 63));
    TEST_ASSERT_EQUAL_INT32(0, steerToPosition(0, 63));
}

void test_steer_to_position_is_proportional(void) {
    TEST_ASSERT_EQUAL_INT32(32, steerToPosition(50, 63));
}

void test_steer_to_position_clamps_rather_than_exceeding_the_stops(void) {
    TEST_ASSERT_EQUAL_INT32(63, steerToPosition(150, 63));
    TEST_ASSERT_EQUAL_INT32(-63, steerToPosition(-150, 63));
}

void test_slew_limit_ramps_toward_the_target(void) {
    TEST_ASSERT_EQUAL_INT(10, slewLimit(0, 100, 10));
    TEST_ASSERT_EQUAL_INT(40, slewLimit(50, 0, 10));
}

void test_slew_limit_does_not_overshoot(void) {
    TEST_ASSERT_EQUAL_INT(100, slewLimit(95, 100, 10));
    TEST_ASSERT_EQUAL_INT(-100, slewLimit(-95, -100, 10));
    TEST_ASSERT_EQUAL_INT(7, slewLimit(7, 7, 10));
}

void test_stall_detector_reports_stall_after_a_full_quiet_window(void) {
    StallDetector d;
    stallReset(&d, 150, 2);
    TEST_ASSERT_FALSE(stallPush(&d, 0, 100));
    TEST_ASSERT_FALSE(stallPush(&d, 50, 101));
    TEST_ASSERT_FALSE(stallPush(&d, 100, 100));   // window not yet full
    TEST_ASSERT_TRUE(stallPush(&d, 160, 101));
}

void test_stall_detector_stays_quiet_while_still_turning(void) {
    StallDetector d;
    stallReset(&d, 150, 2);
    stallPush(&d, 0, 100);
    stallPush(&d, 50, 120);
    stallPush(&d, 100, 140);
    TEST_ASSERT_FALSE(stallPush(&d, 160, 160));
}

void test_stall_detector_resets_cleanly_between_sweeps(void) {
    StallDetector d;
    stallReset(&d, 150, 2);
    stallPush(&d, 0, 100);
    stallPush(&d, 160, 100);
    stallReset(&d, 150, 2);
    TEST_ASSERT_FALSE(stallPush(&d, 200, 100));   // history was cleared
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    UNITY_BEGIN();
    RUN_TEST(test_compute_range_centers_and_applies_margin);
    RUN_TEST(test_compute_range_rejects_a_sweep_that_did_not_move);
    RUN_TEST(test_steer_to_position_hits_the_range_ends);
    RUN_TEST(test_steer_to_position_is_proportional);
    RUN_TEST(test_steer_to_position_clamps_rather_than_exceeding_the_stops);
    RUN_TEST(test_slew_limit_ramps_toward_the_target);
    RUN_TEST(test_slew_limit_does_not_overshoot);
    RUN_TEST(test_stall_detector_reports_stall_after_a_full_quiet_window);
    RUN_TEST(test_stall_detector_stays_quiet_while_still_turning);
    RUN_TEST(test_stall_detector_resets_cleanly_between_sweeps);
    return UNITY_END();
}
