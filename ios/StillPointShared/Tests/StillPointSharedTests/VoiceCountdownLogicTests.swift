import Foundation
import Testing
@testable import StillPointShared

struct VoiceCountdownLogicTests {

    // MARK: - announceSecond

    @Test func testAnnounceSecondCeilBehaviorAtHalfSecond() {
        // remaining = 29.5 → ceil = 30; first call → should announce 30
        #expect(VoiceCountdownLogic.announceSecond(remaining: 29.5, lastAnnouncedSec: 0) == 30)
    }

    @Test func testAnnounceSecondClampsToOneAtFloor() {
        // remaining < 1 but > 0 → ceil may be 1; clamp ensures min is 1
        #expect(VoiceCountdownLogic.announceSecond(remaining: 0.1, lastAnnouncedSec: 0) == 1)
    }

    @Test func testAnnounceSecondClampsToSixtyAtCeiling() {
        // remaining = 60 → ceil = 60; clamped to 60
        #expect(VoiceCountdownLogic.announceSecond(remaining: 60.0, lastAnnouncedSec: 0) == 60)
    }

    @Test func testAnnounceSecondDedupsRepeat() {
        // Second call with same ceil value → nil (already announced)
        #expect(VoiceCountdownLogic.announceSecond(remaining: 10.0, lastAnnouncedSec: 0) == 10)
        #expect(VoiceCountdownLogic.announceSecond(remaining: 10.0, lastAnnouncedSec: 10) == nil)
    }

    @Test func testAnnounceSecondReturnsNilWhenAboveSixty() {
        #expect(VoiceCountdownLogic.announceSecond(remaining: 61.0, lastAnnouncedSec: 0) == nil)
    }

    @Test func testAnnounceSecondReturnsNilWhenExactlyZero() {
        #expect(VoiceCountdownLogic.announceSecond(remaining: 0.0, lastAnnouncedSec: 0) == nil)
    }

    @Test func testAnnounceSecondReturnsNilWhenNegative() {
        #expect(VoiceCountdownLogic.announceSecond(remaining: -1.0, lastAnnouncedSec: 0) == nil)
    }

    @Test func testAnnounceSecondSequenceDownFrom5() {
        // Simulate five 1-second ticks from remaining = 5 down to 1
        var last = 0
        var announced: [Int] = []
        for remaining in stride(from: 5.0, through: 1.0, by: -1.0) {
            if let sec = VoiceCountdownLogic.announceSecond(remaining: remaining, lastAnnouncedSec: last) {
                announced.append(sec)
                last = sec
            }
        }
        #expect(announced == [5, 4, 3, 2, 1])
    }

    @Test func testAnnounceSecondSkipsAfterResetAbove60() {
        // Announce at 30 s with a clean last-announced state.
        let firstAnnounce = VoiceCountdownLogic.announceSecond(remaining: 30.0, lastAnnouncedSec: 0)
        #expect(firstAnnounce == 30)

        // Remaining rises above 60 (e.g. bonus time added) — shouldReset returns true
        // and the caller zeros lastAnnouncedSec before the next tick.
        #expect(VoiceCountdownLogic.shouldReset(remaining: 90.0))

        // After the reset the same second (30) must be announced again.
        let afterReset = VoiceCountdownLogic.announceSecond(remaining: 30.0, lastAnnouncedSec: 0)
        #expect(afterReset == 30)
    }

    // MARK: - shouldReset

    @Test func testShouldResetWhenAboveSixty() {
        #expect(VoiceCountdownLogic.shouldReset(remaining: 60.001))
        #expect(VoiceCountdownLogic.shouldReset(remaining: 61.0))
        #expect(VoiceCountdownLogic.shouldReset(remaining: 120.0))
    }

    @Test func testShouldNotResetAtOrBelowSixty() {
        #expect(!VoiceCountdownLogic.shouldReset(remaining: 60.0))
        #expect(!VoiceCountdownLogic.shouldReset(remaining: 30.0))
        #expect(!VoiceCountdownLogic.shouldReset(remaining: 0.0))
    }

    // MARK: - isActive

    @Test func testIsActiveInFinalMinute() {
        #expect(VoiceCountdownLogic.isActive(remaining: 60.0))
        #expect(VoiceCountdownLogic.isActive(remaining: 1.0))
        #expect(VoiceCountdownLogic.isActive(remaining: 0.1))
    }

    @Test func testIsNotActiveAboveSixty() {
        #expect(!VoiceCountdownLogic.isActive(remaining: 60.001))
        #expect(!VoiceCountdownLogic.isActive(remaining: 61.0))
    }

    @Test func testIsNotActiveAtZeroOrBelow() {
        #expect(!VoiceCountdownLogic.isActive(remaining: 0.0))
        #expect(!VoiceCountdownLogic.isActive(remaining: -1.0))
    }
}
