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
    /// haptic still marks its own interval. #1179: with under a whole minute
    /// left the 60 s mark is no burst, so ten-second mode buzzes there and
    /// every-minute mode stays still.
    @Test func testTheRepeatingHapticKeepsItsOwnIntervalWhereTheBellHasNoMinuteBlocks() {
        let tens = advance(60.02, total: 90, prefs: prefs(chime: true, haptics: true, interval: .tenSeconds))
        #expect(!tens.effects.playChime)
        #expect(tens.effects.haptic == .minuteMarker)

        let minute = advance(60.02, total: 90, prefs: prefs(chime: true, haptics: true))
        #expect(minute.effects.haptic == nil)
        #expect(minute.cursor.lastHapticIntervalIndex == 1)
    }

    @Test func testTheRepeatingHapticStaysStillWhenOffOrAbandonedButKeepsCounting() {
        let on = advance(60.02, total: 300, prefs: prefs(haptics: true))
        #expect(on.effects.haptic == .minuteBurst(taps: 4))

        let off = advance(60.02, total: 300, prefs: prefs())
        #expect(off.effects.haptic == nil)
        #expect(off.cursor.lastHapticIntervalIndex == 1)

        let abandoned = advance(60.02, total: 300, prefs: prefs(haptics: true), abandoned: true)
        #expect(abandoned.effects.haptic == nil)
        #expect(abandoned.cursor.lastHapticIntervalIndex == 1)
    }

    /// #1175: every second plays the light pulse, never on the end tick, and
    /// the end buzz still closes the sit.
    @Test func testTheEverySecondIntervalPulsesEachSecondThenEnds() {
        let effects = simulateSit(total: 5, prefs: prefs(haptics: true, interval: .everySecond))
        #expect(effects.compactMap(\.haptic) == [
            .secondPulse, .secondPulse, .secondPulse, .secondPulse, .sessionEnd,
        ])
    }

    // MARK: - Layering (#1179)

    /// Every-second mode in a 2:30 sit: the pulse each second, the buzz on
    /// ten-second marks, the burst on whole minutes, the end at 0:00.
    @Test func testEverySecondLayersThePulseTheBuzzAndTheBurst() {
        let firings = simulateSit(total: 150, prefs: prefs(haptics: true, interval: .everySecond)).compactMap(\.haptic)
        #expect(firings.count == 150)
        #expect(firings.last == .sessionEnd)
        let repeating = Array(firings.dropLast())
        // Second n (1-based) is repeating[n - 1].
        #expect(repeating[59] == .minuteBurst(taps: 1))
        #expect(repeating[119] == .minuteMarker) // 0:30 left: no whole minute
        #expect(repeating[9] == .minuteMarker)
        #expect(repeating[0] == .secondPulse)
        #expect(repeating.filter { $0.cue == .minuteBurst }.count == 1)
        #expect(repeating.filter { $0 == .minuteMarker }.count == 13)
        #expect(repeating.filter { $0 == .secondPulse }.count == 135)
    }

    /// Every-10-seconds mode: the buzz plus the minute burst, nothing finer.
    @Test func testEveryTenSecondsLayersTheBuzzAndTheBurst() {
        let firings = simulateSit(total: 180, prefs: prefs(haptics: true, interval: .tenSeconds)).compactMap(\.haptic)
        let bursts: [HapticCueLogic.Firing] = [.minuteBurst(taps: 2), .minuteBurst(taps: 1)]
        #expect(firings.filter { $0.cue == .minuteBurst } == bursts)
        #expect(firings.filter { $0 == .minuteMarker }.count == 15)
        #expect(!firings.contains(.secondPulse))
        #expect(firings.last == .sessionEnd)
        #expect(firings.count == 18)
    }

    /// Every-minute mode: the burst only, counting down to the end.
    @Test func testEveryMinutePlaysOnlyTheCountdownBurst() {
        let firings = simulateSit(total: 300, prefs: prefs(haptics: true)).compactMap(\.haptic)
        #expect(firings == [
            .minuteBurst(taps: 4), .minuteBurst(taps: 3), .minuteBurst(taps: 2), .minuteBurst(taps: 1), .sessionEnd,
        ])
    }

    /// A long sit taps out every minute left, uncapped.
    @Test func testALongSitBurstsTheWholeMinutesLeft() {
        let firings = simulateSit(total: 1800, prefs: prefs(haptics: true)).compactMap(\.haptic)
        #expect(firings.first == .minuteBurst(taps: 29))
        #expect(firings.dropLast().last == .minuteBurst(taps: 1))
        #expect(firings.count == 30)
    }

    /// #1176: a tick that first sees a minute long after it passed drops it.
    @Test func testALateBurstIsDroppedNotPlayed() {
        let late = advance(125, total: 600, prefs: prefs(haptics: true), cursor: cursor(tick: 0, minuteBlock: 0, hapticInterval: 1))
        #expect(late.effects.haptic == nil)
        #expect(late.cursor.lastHapticIntervalIndex == 2)
    }
}
