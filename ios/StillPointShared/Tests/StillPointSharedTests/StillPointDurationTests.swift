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

    func testBlockCountForBaseDuration() {
        XCTAssertEqual(StillPoint.blockCount(forDuration: StillPoint.baseDuration), 6)
    }

    func testBlockCountRoundsUpForPartialBlocks() {
        // 65s = 6 full 10s blocks + 1 partial → 7 blocks
        XCTAssertEqual(StillPoint.blockCount(forDuration: 65), 7)
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
