import XCTest
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the once-per-second tick.
final class SessionTickLogicTickTests: XCTestCase, SessionTickLogicTestSupport {

    func testTheTickPlaysOncePerWholeSecond() {
        var current = SessionTickLogic.Cursor.fresh
        var played: [Double] = []
        for elapsed in [0.05, 0.5, 0.95, 1.0, 1.05, 1.5, 2.0, 2.05] {
            let outcome = advance(elapsed, total: 300, prefs: prefs(tick: true), cursor: current)
            current = outcome.cursor
            if outcome.effects.playTick { played.append(elapsed) }
        }
        XCTAssertEqual(played, [1.0, 2.0])
        XCTAssertEqual(current.lastTickSec, 2)
    }

    func testTickProgressOnlyMovesWhileTheTickIsOn() {
        let quiet = advance(10.3, total: 300, prefs: prefs())
        XCTAssertFalse(quiet.effects.playTick)
        XCTAssertEqual(quiet.cursor.lastTickSec, 0)

        // Turning the tick on plays one tick straight away, then keeps time.
        let turnedOn = advance(10.35, total: 300, prefs: prefs(tick: true), cursor: quiet.cursor)
        XCTAssertTrue(turnedOn.effects.playTick)
        XCTAssertEqual(turnedOn.cursor.lastTickSec, 10)

        let sameSecond = advance(10.4, total: 300, prefs: prefs(tick: true), cursor: turnedOn.cursor)
        XCTAssertFalse(sameSecond.effects.playTick)
    }
}
