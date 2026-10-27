import XCTest
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the repeating haptic and its own
/// interval.
final class SessionTickLogicHapticTests: XCTestCase, SessionTickLogicTestSupport {

    func testTheRepeatingHapticFiresAtEachIntervalAndTheEndBuzzClosesTheSit() {
        let effects = simulateSit(total: 30, prefs: prefs(haptics: true, interval: .tenSeconds))
        XCTAssertEqual(effects.compactMap(\.haptic), [.minuteMarker, .minuteMarker, .sessionEnd])
    }

    /// A 90 s sit has no minute blocks, so the bell never strikes, yet the
    /// haptic still marks its own 60 s interval.
    func testTheRepeatingHapticKeepsItsOwnIntervalWhereTheBellHasNoMinuteBlocks() {
        let outcome = advance(60.02, total: 90, prefs: prefs(chime: true, haptics: true))
        XCTAssertFalse(outcome.effects.playChime)
        XCTAssertEqual(outcome.effects.haptic, .minuteMarker)
    }

    func testTheRepeatingHapticStaysStillWhenOffOrAbandonedButKeepsCounting() {
        let on = advance(60.02, total: 300, prefs: prefs(haptics: true))
        XCTAssertEqual(on.effects.haptic, .minuteMarker)

        let off = advance(60.02, total: 300, prefs: prefs())
        XCTAssertNil(off.effects.haptic)
        XCTAssertEqual(off.cursor.lastHapticIntervalIndex, 1)

        let abandoned = advance(60.02, total: 300, prefs: prefs(haptics: true), abandoned: true)
        XCTAssertNil(abandoned.effects.haptic)
        XCTAssertEqual(abandoned.cursor.lastHapticIntervalIndex, 1)
    }
}
