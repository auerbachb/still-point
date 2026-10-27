import XCTest
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: what a resume seeds into the
/// cursor and must not replay.
final class SessionTickLogicResumeTests: XCTestCase, SessionTickLogicTestSupport {

    func testResumingSeedsEachCursorFromThePausedElapsedTime() {
        let resumed = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 60)
        XCTAssertEqual(resumed, cursor(tick: 130, minuteBlock: 1, hapticInterval: 2, voice: 0))

        let tenSecond = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 10)
        XCTAssertEqual(tenSecond.lastHapticIntervalIndex, 13)
    }

    func testAResumeDoesNotReplayCuesThatPlayedBeforeThePause() {
        let resumed = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 60)
        let outcome = advance(130.45, total: 260, prefs: prefs(tick: true, chime: true, haptics: true), cursor: resumed)

        XCTAssertFalse(outcome.effects.playTick)
        XCTAssertFalse(outcome.effects.playChime)
        XCTAssertNil(outcome.effects.haptic)
        XCTAssertEqual(outcome.cursor, resumed)
    }

    func testAResumeInsideTheFinalMinuteAnnouncesTheCurrentSecondAgain() {
        // Paused with 45 s left, after 45 had already been spoken.
        let resumed = SessionTickLogic.Cursor.resuming(at: 255, totalSeconds: 300, hapticIntervalSeconds: 60)
        XCTAssertEqual(resumed.lastVoiceCountdownSec, 0)

        let outcome = advance(255.02, total: 300, prefs: prefs(voice: true), cursor: resumed)
        XCTAssertEqual(outcome.effects.voiceCountdownSecond, 45)
    }
}
