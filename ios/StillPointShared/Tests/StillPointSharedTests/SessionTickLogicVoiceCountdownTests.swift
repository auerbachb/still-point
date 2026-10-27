import XCTest
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions: the final-minute voice countdown
/// and the cues it silences.
final class SessionTickLogicVoiceCountdownTests: XCTestCase, SessionTickLogicTestSupport {

    func testVoiceCountdownSpeaksEachSecondOfTheFinalMinuteAndSilencesTheTick() {
        let effects = simulateSit(total: 90, prefs: prefs(tick: true, voice: true))
        XCTAssertEqual(effects.compactMap(\.voiceCountdownSecond), Array((1...60).reversed()))
        // Ticks play for the first 29 s; from 60 s left the countdown takes over.
        XCTAssertEqual(effects.filter(\.playTick).count, 29)
    }

    func testASilencedTickStillCountsSoItIsNotPlayedLate() {
        let outcome = advance(241.0, total: 300, prefs: prefs(tick: true, voice: true), cursor: cursor(tick: 240, minuteBlock: 3, hapticInterval: 4))
        XCTAssertFalse(outcome.effects.playTick)
        XCTAssertEqual(outcome.cursor.lastTickSec, 241)
        XCTAssertEqual(outcome.effects.voiceCountdownSecond, 59)
    }

    /// 180 s: the second minute block ends at 120 with exactly one minute left,
    /// so the bell is due on the same tick the countdown begins.
    func testVoiceCountdownSilencesTheBellThatWouldMarkTheStartOfTheFinalMinute() {
        let atBoundary = cursor(tick: 120, minuteBlock: 0, hapticInterval: 2)

        let withoutVoice = advance(120.02, total: 180, prefs: prefs(chime: true), cursor: atBoundary)
        XCTAssertTrue(withoutVoice.effects.playChime)

        let withVoice = advance(120.02, total: 180, prefs: prefs(chime: true, voice: true), cursor: atBoundary)
        XCTAssertFalse(withVoice.effects.playChime)
        XCTAssertEqual(withVoice.cursor.lastCompletedMinuteBlockIndex, 1)
        XCTAssertEqual(withVoice.effects.voiceCountdownSecond, 60)
    }

    /// #853: outside the final minute the bell follows the chime switch in
    /// voice mode too. Web's `sessionCues.test.ts` pins the same rule.
    func testVoiceCountdownLeavesABellOutsideTheFinalMinuteToTheChimeSwitch() {
        let outcome = advance(60.02, total: 300, prefs: prefs(chime: true, voice: true))
        XCTAssertTrue(outcome.effects.playChime)
        XCTAssertNil(outcome.effects.voiceCountdownSecond)
        XCTAssertFalse(outcome.effects.cancelVoiceCountdown)
    }

    /// #853: a five-minute sit rings at one, two and three minutes. At four
    /// minutes the countdown opens the final minute instead.
    func testAFiveMinuteVoiceCountdownSitRingsEveryMinuteButTheOneThatOpensTheFinalMinute() {
        let effects = simulateSit(total: 300, prefs: prefs(chime: true, voice: true))
        // `effects[i]` is the tick at elapsed (i + 1) / 20 s.
        let bellTimes = effects.indices.filter { effects[$0].playChime }.map { Double($0 + 1) / 20 }
        XCTAssertEqual(bellTimes, [60, 120, 180])
    }

    func testABonusThatLiftsRemainingAboveAMinuteRestartsTheCountdown() {
        // 30 had been spoken with 30 s left; a 60 s bonus put 90 s back on the clock.
        let announcing = cursor(tick: 270, minuteBlock: 3, hapticInterval: 4, voice: 30)
        let reset = advance(270.02, total: 360, prefs: prefs(voice: true), cursor: announcing)
        XCTAssertTrue(reset.effects.cancelVoiceCountdown)
        XCTAssertNil(reset.effects.voiceCountdownSecond)
        XCTAssertEqual(reset.cursor.lastVoiceCountdownSec, 0)

        let finalMinuteAgain = advance(300.0, total: 360, prefs: prefs(voice: true), cursor: reset.cursor)
        XCTAssertEqual(finalMinuteAgain.effects.voiceCountdownSecond, 60)
    }

    func testOutsideTheFinalMinuteWithNothingSpokenTheCountdownCancelsNothing() {
        let outcome = advance(30.0, total: 300, prefs: prefs(voice: true))
        XCTAssertFalse(outcome.effects.cancelVoiceCountdown)
        XCTAssertNil(outcome.effects.voiceCountdownSecond)
    }

    func testWithVoiceCountdownOffTheTickAndTheBellPlayIntoTheFinalMinute() {
        let outcome = advance(120.02, total: 180, prefs: prefs(tick: true, chime: true), cursor: cursor(tick: 119, minuteBlock: 0, hapticInterval: 2))
        XCTAssertNil(outcome.effects.voiceCountdownSecond)
        XCTAssertFalse(outcome.effects.cancelVoiceCountdown)
        XCTAssertTrue(outcome.effects.playTick)
        XCTAssertTrue(outcome.effects.playChime)
    }
}
