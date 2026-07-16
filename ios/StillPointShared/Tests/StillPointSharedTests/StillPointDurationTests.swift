import XCTest
@testable import StillPointShared

final class StillPointDurationTests: XCTestCase {
    func testDurationAtDayOneReturnsBaseDuration() {
        XCTAssertEqual(StillPoint.duration(forDay: 1), StillPoint.baseDuration)
    }

    func testDurationGrowsByIncrementPerDay() {
        XCTAssertEqual(StillPoint.duration(forDay: 2), StillPoint.baseDuration + StillPoint.increment)
        XCTAssertEqual(StillPoint.duration(forDay: 5), StillPoint.baseDuration + 4 * StillPoint.increment)
        XCTAssertEqual(StillPoint.duration(forDay: 30), StillPoint.baseDuration + 29 * StillPoint.increment)
    }

    func testQuickDurationIsAlwaysOneMinute() {
        XCTAssertEqual(StillPoint.duration(for: .quick, day: 1), StillPoint.quickDuration)
        XCTAssertEqual(StillPoint.duration(for: .quick, day: 30), StillPoint.quickDuration)
    }

    func testStandardSessionAdvancesDayButQuickDoesNot() {
        XCTAssertTrue(StillPoint.shouldAdvanceDay(sessionType: .standard, completed: true))
        XCTAssertFalse(StillPoint.shouldAdvanceDay(sessionType: .quick, completed: true))
        XCTAssertFalse(StillPoint.shouldAdvanceDay(sessionType: .standard, completed: false))
    }

    func testBlockCountForBaseDuration() {
        XCTAssertEqual(StillPoint.blockCount(forDuration: StillPoint.baseDuration), 6)
    }

    func testBlockCountRoundsUpForPartialBlocks() {
        // 65s = 6 full 10s blocks + 1 partial → 7 blocks
        XCTAssertEqual(StillPoint.blockCount(forDuration: 65), 7)
    }

    // MARK: - #240 dual-track: 10-minute cap + fork eligibility

    func testDurationCapsAtTenMinutes() {
        XCTAssertEqual(StillPoint.duration(forDay: 54), 590)
        XCTAssertEqual(StillPoint.duration(forDay: StillPoint.forkDay), StillPoint.maxDuration)
        XCTAssertEqual(StillPoint.duration(forDay: 56), StillPoint.maxDuration)
        XCTAssertEqual(StillPoint.duration(forDay: 200), StillPoint.maxDuration)
    }

    func testForkDayIsFirstDayAtCap() {
        XCTAssertEqual(StillPoint.forkDay, 55)
        XCTAssertLessThan(StillPoint.duration(forDay: StillPoint.forkDay - 1), StillPoint.maxDuration)
    }

    func testIsDualTrackEligibleOnlyAfterTenMinuteSit() {
        XCTAssertFalse(StillPoint.isDualTrackEligible(currentDay: 1))
        XCTAssertFalse(StillPoint.isDualTrackEligible(currentDay: StillPoint.forkDay))
        XCTAssertTrue(StillPoint.isDualTrackEligible(currentDay: StillPoint.forkDay + 1))
    }

    func testAdvanceSecondTrackDay() {
        XCTAssertEqual(StillPoint.advanceSecondTrackDay(sessionType: .standard, completed: true, secondTrackDay: 1), 2)
        XCTAssertEqual(StillPoint.advanceSecondTrackDay(sessionType: .quick, completed: true, secondTrackDay: 3), 3)
        XCTAssertEqual(StillPoint.advanceSecondTrackDay(sessionType: .standard, completed: false, secondTrackDay: 3), 3)
    }

    // MARK: - Shared fixtures (#540/#421)

    func testDurationForDaySharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)

        XCTAssertEqual(fixture.constants.forkDay, StillPoint.forkDay)
        XCTAssertEqual(fixture.constants.maxDuration, StillPoint.maxDuration)

        for testCase in fixture.durationForDay {
            XCTAssertEqual(
                StillPoint.duration(forDay: testCase.day),
                testCase.expected,
                "durationForDay day \(testCase.day)"
            )
        }

        for testCase in fixture.isDualTrackEligible {
            XCTAssertEqual(
                StillPoint.isDualTrackEligible(currentDay: testCase.currentDay),
                testCase.expected,
                "isDualTrackEligible currentDay \(testCase.currentDay)"
            )
        }
    }

    // Note: invalid days (`< 1`) are tested via `clampedCurrentDay(for:)` below.
    // Calling `duration(forDay:)` with `< 1` traps the debug `assert` in the
    // test runner (intended dev behavior); production builds survive via the
    // `max(day, 1)` clamp.

    // MARK: - clampedCurrentDay edge cases

    func testClampedCurrentDayWithNilUserReturnsOne() {
        XCTAssertEqual(StillPoint.clampedCurrentDay(for: nil), 1)
    }

    func testClampedCurrentDayWithZeroReturnsOne() {
        XCTAssertEqual(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 0)), 1)
    }

    func testClampedCurrentDayWithNegativeReturnsOne() {
        XCTAssertEqual(StillPoint.clampedCurrentDay(for: makeUser(currentDay: -5)), 1)
    }

    func testClampedCurrentDayWithValidPositiveReturnsValue() {
        XCTAssertEqual(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 1)), 1)
        XCTAssertEqual(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 7)), 7)
        XCTAssertEqual(StillPoint.clampedCurrentDay(for: makeUser(currentDay: 365)), 365)
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
