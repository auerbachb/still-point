import Foundation
import Testing
@testable import StillPointShared

struct StillPointDurationTests {
    @Test func testDurationAtDayOneReturnsBaseDuration() {
        #expect(StillPoint.duration(forDay: 1) == StillPoint.baseDuration)
    }

    @Test func testDurationGrowsByIncrementPerDay() {
        #expect(StillPoint.duration(forDay: 2) == StillPoint.baseDuration + StillPoint.increment)
        #expect(StillPoint.duration(forDay: 5) == StillPoint.baseDuration + 4 * StillPoint.increment)
        #expect(StillPoint.duration(forDay: 30) == StillPoint.baseDuration + 29 * StillPoint.increment)
    }

    @Test func testQuickDurationIsAlwaysOneMinute() {
        #expect(StillPoint.duration(for: .quick, day: 1) == StillPoint.quickDuration)
        #expect(StillPoint.duration(for: .quick, day: 30) == StillPoint.quickDuration)
    }

    @Test func testStandardSessionAdvancesDayButQuickDoesNot() {
        #expect(StillPoint.shouldAdvanceDay(sessionType: .standard, completed: true))
        #expect(!StillPoint.shouldAdvanceDay(sessionType: .quick, completed: true))
        #expect(!StillPoint.shouldAdvanceDay(sessionType: .standard, completed: false))
    }

    @Test func testBlockCountForBaseDuration() {
        #expect(StillPoint.blockCount(forDuration: StillPoint.baseDuration) == 6)
    }

    @Test func testBlockCountRoundsUpForPartialBlocks() {
        // 65s = 6 full 10s blocks + 1 partial → 7 blocks
        #expect(StillPoint.blockCount(forDuration: 65) == 7)
    }

    // MARK: - #240 dual-track: 10-minute cap + fork eligibility

    @Test func testDurationCapsAtTenMinutes() {
        #expect(StillPoint.duration(forDay: 54) == 590)
        #expect(StillPoint.duration(forDay: StillPoint.forkDay) == StillPoint.maxDuration)
        #expect(StillPoint.duration(forDay: 56) == StillPoint.maxDuration)
        #expect(StillPoint.duration(forDay: 200) == StillPoint.maxDuration)
    }

    @Test func testForkDayIsFirstDayAtCap() {
        #expect(StillPoint.forkDay == 55)
        #expect(StillPoint.duration(forDay: StillPoint.forkDay - 1) < StillPoint.maxDuration)
    }

    @Test func testIsDualTrackEligibleOnlyAfterTenMinuteSit() {
        #expect(!StillPoint.isDualTrackEligible(currentDay: 1))
        #expect(!StillPoint.isDualTrackEligible(currentDay: StillPoint.forkDay))
        #expect(StillPoint.isDualTrackEligible(currentDay: StillPoint.forkDay + 1))
    }

    @Test func testAdvanceSecondTrackDay() {
        #expect(StillPoint.advanceSecondTrackDay(sessionType: .standard, completed: true, secondTrackDay: 1) == 2)
        #expect(StillPoint.advanceSecondTrackDay(sessionType: .quick, completed: true, secondTrackDay: 3) == 3)
        #expect(StillPoint.advanceSecondTrackDay(sessionType: .standard, completed: false, secondTrackDay: 3) == 3)
    }

    // MARK: - Shared fixtures (#540/#421)

    @Test func testDurationForDaySharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)

        #expect(fixture.constants.forkDay == StillPoint.forkDay)
        #expect(fixture.constants.maxDuration == StillPoint.maxDuration)

        for testCase in fixture.durationForDay {
            #expect(StillPoint.duration(forDay: testCase.day) == testCase.expected, "durationForDay day \(testCase.day)")
        }

        for testCase in fixture.isDualTrackEligible {
            #expect(
                StillPoint.isDualTrackEligible(currentDay: testCase.currentDay) == testCase.expected,
                "isDualTrackEligible currentDay \(testCase.currentDay)"
            )
        }
    }

    // Note: invalid days (`< 1`) are tested via `clampedCurrentDay(for:)` below.
    // Calling `duration(forDay:)` with `< 1` traps the debug `assert` in the
    // test runner (intended dev behavior); production builds survive via the
    // `max(day, 1)` clamp.

    // MARK: - clampedCurrentDay edge cases

    @Test func testClampedCurrentDayWithNilUserReturnsOne() {
        #expect(StillPoint.clampedCurrentDay(for: nil) == 1)
    }

    @Test func testClampedCurrentDayWithZeroReturnsOne() {
        #expect(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 0)) == 1)
    }

    @Test func testClampedCurrentDayWithNegativeReturnsOne() {
        #expect(StillPoint.clampedCurrentDay(for: makeUser(currentDay: -5)) == 1)
    }

    @Test func testClampedCurrentDayWithValidPositiveReturnsValue() {
        #expect(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 1)) == 1)
        #expect(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 7)) == 7)
        #expect(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 365)) == 365)
    }

    private func makeUser(currentDay: Int) -> UserDTO {
        UserDTO(
            id: "u1",
            email: "test@example.com",
            username: "tester",
            isPublic: false,
            currentDay: currentDay
        )
    }
}
