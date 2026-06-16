import XCTest
@testable import StillPointShared

final class AppBlockGateTests: XCTestCase {
    // Pin the comparison calendar to the same zone the test dates are built in,
    // so `isDate(_:inSameDayAs:)` does not flip day boundaries when CI runs in UTC.
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        return cal
    }()

    private func date(_ y: Int, _ mo: Int, _ d: Int, _ h: Int = 12, _ mi: Int = 0) -> Date {
        var c = DateComponents()
        c.year = y; c.month = mo; c.day = d; c.hour = h; c.minute = mi
        c.timeZone = TimeZone(identifier: "America/New_York")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    func testNilUnlockIsExpired() {
        XCTAssertTrue(AppBlockGate.isUnlockExpired(unlockedFor: nil, now: date(2026, 6, 15)))
    }

    func testSameDayUnlockIsNotExpired() {
        let morning = date(2026, 6, 15, 6, 30)
        let evening = date(2026, 6, 15, 23, 0)
        XCTAssertFalse(AppBlockGate.isUnlockExpired(unlockedFor: morning, now: evening, calendar: calendar))
    }

    func testYesterdayUnlockIsExpired() {
        let yesterday = date(2026, 6, 14, 23, 30)
        let today = date(2026, 6, 15, 0, 5)
        XCTAssertTrue(AppBlockGate.isUnlockExpired(unlockedFor: yesterday, now: today, calendar: calendar))
    }

    func testFutureDayUnlockIsExpired() {
        // A clock that moved backward should also re-lock (not "today").
        let tomorrow = date(2026, 6, 16, 1, 0)
        let today = date(2026, 6, 15, 12, 0)
        XCTAssertTrue(AppBlockGate.isUnlockExpired(unlockedFor: tomorrow, now: today, calendar: calendar))
    }

    func testJustAfterMidnightExpiresPreviousDayUnlock() {
        // Core #423 boundary: unlock at 11:59pm, "now" one minute later (new day).
        let lastMinute = date(2026, 6, 15, 23, 59)
        let justAfterMidnight = date(2026, 6, 16, 0, 0)
        XCTAssertTrue(AppBlockGate.isUnlockExpired(unlockedFor: lastMinute, now: justAfterMidnight, calendar: calendar))
    }
}
