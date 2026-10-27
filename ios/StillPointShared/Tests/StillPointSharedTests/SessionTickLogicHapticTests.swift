import Foundation
import Testing
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the repeating haptic and its own
/// interval.
struct SessionTickLogicHapticTests: SessionTickLogicTestSupport {

    @Test func testTheRepeatingHapticFiresAtEachIntervalAndTheEndBuzzClosesTheSit() {
        let effects = simulateSit(total: 30, prefs: prefs(haptics: true, interval: .tenSeconds))
        #expect(effects.compactMap(\.haptic) == [.minuteMarker, .minuteMarker, .sessionEnd])
    }

    /// A 90 s sit has no minute blocks, so the bell never strikes, yet the
    /// haptic still marks its own 60 s interval.
    @Test func testTheRepeatingHapticKeepsItsOwnIntervalWhereTheBellHasNoMinuteBlocks() {
        let outcome = advance(60.02, total: 90, prefs: prefs(chime: true, haptics: true))
        #expect(!outcome.effects.playChime)
        #expect(outcome.effects.haptic == .minuteMarker)
    }

    @Test func testTheRepeatingHapticStaysStillWhenOffOrAbandonedButKeepsCounting() {
        let on = advance(60.02, total: 300, prefs: prefs(haptics: true))
        #expect(on.effects.haptic == .minuteMarker)

        let off = advance(60.02, total: 300, prefs: prefs())
        #expect(off.effects.haptic == nil)
        #expect(off.cursor.lastHapticIntervalIndex == 1)

        let abandoned = advance(60.02, total: 300, prefs: prefs(haptics: true), abandoned: true)
        #expect(abandoned.effects.haptic == nil)
        #expect(abandoned.cursor.lastHapticIntervalIndex == 1)
    }
}
