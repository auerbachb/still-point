import Foundation
import Testing
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the once-per-second tick.
struct SessionTickLogicTickTests: SessionTickLogicTestSupport {

    @Test func testTheTickPlaysOncePerWholeSecond() {
        var current = SessionTickLogic.Cursor.fresh
        var played: [Double] = []
        for elapsed in [0.05, 0.5, 0.95, 1.0, 1.05, 1.5, 2.0, 2.05] {
            let outcome = advance(elapsed, total: 300, prefs: prefs(tick: true), cursor: current)
            current = outcome.cursor
            if outcome.effects.playTick { played.append(elapsed) }
        }
        #expect(played == [1.0, 2.0])
        #expect(current.lastTickSec == 2)
    }

    @Test func testTickProgressOnlyMovesWhileTheTickIsOn() {
        let quiet = advance(10.3, total: 300, prefs: prefs())
        #expect(!quiet.effects.playTick)
        #expect(quiet.cursor.lastTickSec == 0)

        // Turning the tick on plays one tick straight away, then keeps time.
        let turnedOn = advance(10.35, total: 300, prefs: prefs(tick: true), cursor: quiet.cursor)
        #expect(turnedOn.effects.playTick)
        #expect(turnedOn.cursor.lastTickSec == 10)

        let sameSecond = advance(10.4, total: 300, prefs: prefs(tick: true), cursor: turnedOn.cursor)
        #expect(!sameSecond.effects.playTick)
    }
}
