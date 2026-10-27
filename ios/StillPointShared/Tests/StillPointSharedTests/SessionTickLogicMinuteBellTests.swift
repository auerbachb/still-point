import Foundation
import Testing
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the minute bell and its full-
/// minute-left rule.
struct SessionTickLogicMinuteBellTests: SessionTickLogicTestSupport {

    @Test func testTheBellStrikesAtAMinuteBoundaryWithAFullMinuteStillToGo() {
        let outcome = advance(60.02, total: 260, prefs: prefs(chime: true))
        #expect(outcome.effects.playChime)
        #expect(outcome.cursor.lastCompletedMinuteBlockIndex == 0)
    }

    /// 260 s: the fourth minute block ends at 240 with only 20 s left (#711).
    @Test func testTheBellStaysSilentAtABoundaryInsideTheFinalMinute() {
        let outcome = advance(240.02, total: 260, prefs: prefs(chime: true), cursor: cursor(tick: 240, minuteBlock: 2, hapticInterval: 4))
        #expect(!outcome.effects.playChime)
        #expect(outcome.cursor.lastCompletedMinuteBlockIndex == 3)
    }

    @Test func testMinuteProgressMovesWhileTheBellIsOffSoUnmutingNeverReplaysIt() {
        let muted = advance(60.02, total: 260, prefs: prefs())
        #expect(!muted.effects.playChime)
        #expect(muted.cursor.lastCompletedMinuteBlockIndex == 0)

        let unmuted = advance(60.07, total: 260, prefs: prefs(chime: true), cursor: muted.cursor)
        #expect(!unmuted.effects.playChime)
    }
}
