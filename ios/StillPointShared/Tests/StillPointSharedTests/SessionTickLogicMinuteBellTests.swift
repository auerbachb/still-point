import XCTest
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the minute bell and its full-
/// minute-left rule.
final class SessionTickLogicMinuteBellTests: XCTestCase, SessionTickLogicTestSupport {

    func testTheBellStrikesAtAMinuteBoundaryWithAFullMinuteStillToGo() {
        let outcome = advance(60.02, total: 260, prefs: prefs(chime: true))
        XCTAssertTrue(outcome.effects.playChime)
        XCTAssertEqual(outcome.cursor.lastCompletedMinuteBlockIndex, 0)
    }

    /// 260 s: the fourth minute block ends at 240 with only 20 s left (#711).
    func testTheBellStaysSilentAtABoundaryInsideTheFinalMinute() {
        let outcome = advance(240.02, total: 260, prefs: prefs(chime: true), cursor: cursor(tick: 240, minuteBlock: 2, hapticInterval: 4))
        XCTAssertFalse(outcome.effects.playChime)
        XCTAssertEqual(outcome.cursor.lastCompletedMinuteBlockIndex, 3)
    }

    func testMinuteProgressMovesWhileTheBellIsOffSoUnmutingNeverReplaysIt() {
        let muted = advance(60.02, total: 260, prefs: prefs())
        XCTAssertFalse(muted.effects.playChime)
        XCTAssertEqual(muted.cursor.lastCompletedMinuteBlockIndex, 0)

        let unmuted = advance(60.07, total: 260, prefs: prefs(chime: true), cursor: muted.cursor)
        XCTAssertFalse(unmuted.effects.playChime)
    }
}
