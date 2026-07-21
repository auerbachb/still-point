import XCTest
@testable import StillPointShared

final class VoiceCountdownLogicTests: XCTestCase {

    // MARK: - announceSecond

    func testAnnounceSecondCeilBehaviorAtHalfSecond() {
        // remaining = 29.5 → ceil = 30; first call → should announce 30
        XCTAssertEqual(VoiceCountdownLogic.announceSecond(remaining: 29.5, lastAnnouncedSec: 0), 30)
    }

    func testAnnounceSecondClampsToOneAtFloor() {
        // remaining < 1 but > 0 → ceil may be 1; clamp ensures min is 1
        XCTAssertEqual(VoiceCountdownLogic.announceSecond(remaining: 0.1, lastAnnouncedSec: 0), 1)
    }

    func testAnnounceSecondClampsToSixtyAtCeiling() {
        // remaining = 60 → ceil = 60; clamped to 60
        XCTAssertEqual(VoiceCountdownLogic.announceSecond(remaining: 60.0, lastAnnouncedSec: 0), 60)
    }

    func testAnnounceSecondDedupsRepeat() {
        // Second call with same ceil value → nil (already announced)
        XCTAssertEqual(VoiceCountdownLogic.announceSecond(remaining: 10.0, lastAnnouncedSec: 0), 10)
        XCTAssertNil(VoiceCountdownLogic.announceSecond(remaining: 10.0, lastAnnouncedSec: 10))
    }

    func testAnnounceSecondReturnsNilWhenAboveSixty() {
        XCTAssertNil(VoiceCountdownLogic.announceSecond(remaining: 61.0, lastAnnouncedSec: 0))
    }

    func testAnnounceSecondReturnsNilWhenExactlyZero() {
        XCTAssertNil(VoiceCountdownLogic.announceSecond(remaining: 0.0, lastAnnouncedSec: 0))
    }

    func testAnnounceSecondReturnsNilWhenNegative() {
        XCTAssertNil(VoiceCountdownLogic.announceSecond(remaining: -1.0, lastAnnouncedSec: 0))
    }

    func testAnnounceSecondSequenceDownFrom5() {
        // Simulate five 1-second ticks from remaining = 5 down to 1
        var last = 0
        var announced: [Int] = []
        for remaining in stride(from: 5.0, through: 1.0, by: -1.0) {
            if let sec = VoiceCountdownLogic.announceSecond(remaining: remaining, lastAnnouncedSec: last) {
                announced.append(sec)
                last = sec
            }
        }
        XCTAssertEqual(announced, [5, 4, 3, 2, 1])
    }

    func testAnnounceSecondSkipsAfterResetAbove60() {
        // After remaining goes above 60 and lastAnnouncedSec is reset to 0,
        // the next tick below 60 should announce again.
        let firstAnnounce = VoiceCountdownLogic.announceSecond(remaining: 30.0, lastAnnouncedSec: 0)
        XCTAssertEqual(firstAnnounce, 30)
        // remaining jumps above 60 (bonus added); state reset to 0
        let afterReset = VoiceCountdownLogic.announceSecond(remaining: 30.0, lastAnnouncedSec: 0)
        XCTAssertEqual(afterReset, 30)
    }

    // MARK: - shouldReset

    func testShouldResetWhenAboveSixty() {
        XCTAssertTrue(VoiceCountdownLogic.shouldReset(remaining: 60.001))
        XCTAssertTrue(VoiceCountdownLogic.shouldReset(remaining: 61.0))
        XCTAssertTrue(VoiceCountdownLogic.shouldReset(remaining: 120.0))
    }

    func testShouldNotResetAtOrBelowSixty() {
        XCTAssertFalse(VoiceCountdownLogic.shouldReset(remaining: 60.0))
        XCTAssertFalse(VoiceCountdownLogic.shouldReset(remaining: 30.0))
        XCTAssertFalse(VoiceCountdownLogic.shouldReset(remaining: 0.0))
    }

    // MARK: - isActive

    func testIsActiveInFinalMinute() {
        XCTAssertTrue(VoiceCountdownLogic.isActive(remaining: 60.0))
        XCTAssertTrue(VoiceCountdownLogic.isActive(remaining: 1.0))
        XCTAssertTrue(VoiceCountdownLogic.isActive(remaining: 0.1))
    }

    func testIsNotActiveAboveSixty() {
        XCTAssertFalse(VoiceCountdownLogic.isActive(remaining: 60.001))
        XCTAssertFalse(VoiceCountdownLogic.isActive(remaining: 61.0))
    }

    func testIsNotActiveAtZeroOrBelow() {
        XCTAssertFalse(VoiceCountdownLogic.isActive(remaining: 0.0))
        XCTAssertFalse(VoiceCountdownLogic.isActive(remaining: -1.0))
    }
}
