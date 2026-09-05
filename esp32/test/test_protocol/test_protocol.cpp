#include <unity.h>
#include "protocol.h"

void setUp(void) {}
void tearDown(void) {}

void test_parses_the_canonical_frame(void) {
    Frame f;
    TEST_ASSERT_TRUE(parseFrame("!-42,80,1*12", &f));
    TEST_ASSERT_EQUAL_INT(-42, f.steer);
    TEST_ASSERT_EQUAL_INT(80, f.throttle);
    TEST_ASSERT_EQUAL_UINT8(1, f.flags);
}

void test_parses_zeroes(void) {
    Frame f;
    TEST_ASSERT_TRUE(parseFrame("!0,0,0*30", &f));
    TEST_ASSERT_EQUAL_INT(0, f.steer);
    TEST_ASSERT_EQUAL_INT(0, f.throttle);
    TEST_ASSERT_EQUAL_UINT8(0, f.flags);
}

void test_parses_full_deflection_both_signs(void) {
    Frame f;
    TEST_ASSERT_TRUE(parseFrame("!100,-100,3*1E", &f));
    TEST_ASSERT_EQUAL_INT(100, f.steer);
    TEST_ASSERT_EQUAL_INT(-100, f.throttle);
    TEST_ASSERT_EQUAL_UINT8(3, f.flags);
}

void test_rejects_a_wrong_checksum(void) {
    Frame f;
    // 12 is the correct checksum; 13 is deliberately wrong. Do not "fix" it.
    TEST_ASSERT_FALSE(parseFrame("!-42,80,1*13", &f));
}

void test_rejects_a_missing_start_byte(void) {
    Frame f;
    TEST_ASSERT_FALSE(parseFrame("-42,80,1*12", &f));
}

void test_rejects_a_missing_checksum_delimiter(void) {
    Frame f;
    TEST_ASSERT_FALSE(parseFrame("!-42,80,1", &f));
}

void test_rejects_too_few_fields(void) {
    Frame f;
    // 0F is the CORRECT checksum for "-42,80" — this must fail on field count.
    TEST_ASSERT_FALSE(parseFrame("!-42,80*0F", &f));
}

void test_rejects_out_of_range_values(void) {
    Frame f;
    // Checksum 32 is CORRECT for this body, so the frame is rejected purely
    // for being outside -100..100 — not for being malformed.
    TEST_ASSERT_FALSE(parseFrame("!200,0,0*32", &f));
}

void test_rejects_trailing_junk_inside_the_body(void) {
    Frame f;
    // 48 is the CORRECT checksum for "0,0,0x" — this must fail on the junk.
    TEST_ASSERT_FALSE(parseFrame("!0,0,0x*48", &f));
}

void test_rejects_an_empty_string(void) {
    Frame f;
    TEST_ASSERT_FALSE(parseFrame("", &f));
}

void test_xor_checksum_matches_the_spec_example(void) {
    const char *body = "-42,80,1";
    TEST_ASSERT_EQUAL_UINT8(0x12, xorChecksum(body, 8));
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    UNITY_BEGIN();
    RUN_TEST(test_parses_the_canonical_frame);
    RUN_TEST(test_parses_zeroes);
    RUN_TEST(test_parses_full_deflection_both_signs);
    RUN_TEST(test_rejects_a_wrong_checksum);
    RUN_TEST(test_rejects_a_missing_start_byte);
    RUN_TEST(test_rejects_a_missing_checksum_delimiter);
    RUN_TEST(test_rejects_too_few_fields);
    RUN_TEST(test_rejects_out_of_range_values);
    RUN_TEST(test_rejects_trailing_junk_inside_the_body);
    RUN_TEST(test_rejects_an_empty_string);
    RUN_TEST(test_xor_checksum_matches_the_spec_example);
    return UNITY_END();
}
