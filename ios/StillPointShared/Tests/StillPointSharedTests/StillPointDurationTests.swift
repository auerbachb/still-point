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

    // Note: invalid days (`< 1`) are tested implicitly — the production code path
    // clamps via `max(day, 1)` so a `day == 0` input cannot crash a Release build.
    // We can't unit-test that branch directly because the companion `assert` traps
    // in Debug (the test runner's configuration), which is the desired dev-time
    // behavior. Coverage of `AppViewModel.currentDay`'s clamp lives in the app.
}
