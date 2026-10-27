import Foundation
import Testing
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: what a resume seeds into the
/// cursor and must not replay.
struct SessionTickLogicResumeTests: SessionTickLogicTestSupport {

    @Test func testResumingSeedsEachCursorFromThePausedElapsedTime() {
        let resumed = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 60)
        #expect(resumed == cursor(tick: 130, minuteBlock: 1, hapticInterval: 2, voice: 0))

        let tenSecond = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 10)
        #expect(tenSecond.lastHapticIntervalIndex == 13)
    }

    @Test func testAResumeDoesNotReplayCuesThatPlayedBeforeThePause() {
        let resumed = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 60)
        let outcome = advance(130.45, total: 260, prefs: prefs(tick: true, chime: true, haptics: true), cursor: resumed)

        #expect(!outcome.effects.playTick)
        #expect(!outcome.effects.playChime)
        #expect(outcome.effects.haptic == nil)
        #expect(outcome.cursor == resumed)
    }

    @Test func testAResumeInsideTheFinalMinuteAnnouncesTheCurrentSecondAgain() {
        // Paused with 45 s left, after 45 had already been spoken.
        let resumed = SessionTickLogic.Cursor.resuming(at: 255, totalSeconds: 300, hapticIntervalSeconds: 60)
        #expect(resumed.lastVoiceCountdownSec == 0)

        let outcome = advance(255.02, total: 300, prefs: prefs(voice: true), cursor: resumed)
        #expect(outcome.effects.voiceCountdownSecond == 45)
    }
}
