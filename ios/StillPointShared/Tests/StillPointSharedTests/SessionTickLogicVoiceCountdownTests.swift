import Foundation
import Testing
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the final-minute voice countdown
/// and the cues it silences.
struct SessionTickLogicVoiceCountdownTests: SessionTickLogicTestSupport {

    @Test func testVoiceCountdownSpeaksEachSecondOfTheFinalMinuteAndSilencesTheTick() {
        let effects = simulateSit(total: 90, prefs: prefs(tick: true, voice: true))
        #expect(effects.compactMap(\.voiceCountdownSecond) == Array((1...60).reversed()))
        // Ticks play for the first 29 s; from 60 s left the countdown takes over.
        #expect(effects.filter(\.playTick).count == 29)
    }

    @Test func testASilencedTickStillCountsSoItIsNotPlayedLate() {
        let outcome = advance(241.0, total: 300, prefs: prefs(tick: true, voice: true), cursor: cursor(tick: 240, minuteBlock: 3, hapticInterval: 4))
        #expect(!outcome.effects.playTick)
        #expect(outcome.cursor.lastTickSec == 241)
        #expect(outcome.effects.voiceCountdownSecond == 59)
    }

    /// 180 s: the second minute block ends at 120 with exactly one minute left,
    /// so the bell is due on the same tick the countdown begins.
    @Test func testVoiceCountdownSilencesTheBellThatWouldMarkTheStartOfTheFinalMinute() {
        let atBoundary = cursor(tick: 120, minuteBlock: 0, hapticInterval: 2)

        let withoutVoice = advance(120.02, total: 180, prefs: prefs(chime: true), cursor: atBoundary)
        #expect(withoutVoice.effects.playChime)

        let withVoice = advance(120.02, total: 180, prefs: prefs(chime: true, voice: true), cursor: atBoundary)
        #expect(!withVoice.effects.playChime)
        #expect(withVoice.cursor.lastCompletedMinuteBlockIndex == 1)
        #expect(withVoice.effects.voiceCountdownSecond == 60)
    }

    /// #853: outside the final minute the bell follows the chime switch in
    /// voice mode too. Web's `sessionCues.test.ts` pins the same rule.
    @Test func testVoiceCountdownLeavesABellOutsideTheFinalMinuteToTheChimeSwitch() {
        let outcome = advance(60.02, total: 300, prefs: prefs(chime: true, voice: true))
        #expect(outcome.effects.playChime)
        #expect(outcome.effects.voiceCountdownSecond == nil)
        #expect(!outcome.effects.cancelVoiceCountdown)
    }

    /// #853: a five-minute sit rings at one, two and three minutes. At four
    /// minutes the countdown opens the final minute instead.
    @Test func testAFiveMinuteVoiceCountdownSitRingsEveryMinuteButTheOneThatOpensTheFinalMinute() {
        let effects = simulateSit(total: 300, prefs: prefs(chime: true, voice: true))
        // `effects[i]` is the tick at elapsed (i + 1) / 20 s.
        let bellTimes = effects.indices.filter { effects[$0].playChime }.map { Double($0 + 1) / 20 }
        #expect(bellTimes == [60, 120, 180])
    }

    @Test func testABonusThatLiftsRemainingAboveAMinuteRestartsTheCountdown() {
        // 30 had been spoken with 30 s left; a 60 s bonus put 90 s back on the clock.
        let announcing = cursor(tick: 270, minuteBlock: 3, hapticInterval: 4, voice: 30)
        let reset = advance(270.02, total: 360, prefs: prefs(voice: true), cursor: announcing)
        #expect(reset.effects.cancelVoiceCountdown)
        #expect(reset.effects.voiceCountdownSecond == nil)
        #expect(reset.cursor.lastVoiceCountdownSec == 0)

        let finalMinuteAgain = advance(300.0, total: 360, prefs: prefs(voice: true), cursor: reset.cursor)
        #expect(finalMinuteAgain.effects.voiceCountdownSecond == 60)
    }

    @Test func testOutsideTheFinalMinuteWithNothingSpokenTheCountdownCancelsNothing() {
        let outcome = advance(30.0, total: 300, prefs: prefs(voice: true))
        #expect(!outcome.effects.cancelVoiceCountdown)
        #expect(outcome.effects.voiceCountdownSecond == nil)
    }

    @Test func testWithVoiceCountdownOffTheTickAndTheBellPlayIntoTheFinalMinute() {
        let outcome = advance(120.02, total: 180, prefs: prefs(tick: true, chime: true), cursor: cursor(tick: 119, minuteBlock: 0, hapticInterval: 2))
        #expect(outcome.effects.voiceCountdownSecond == nil)
        #expect(!outcome.effects.cancelVoiceCountdown)
        #expect(outcome.effects.playTick)
        #expect(outcome.effects.playChime)
    }
}
