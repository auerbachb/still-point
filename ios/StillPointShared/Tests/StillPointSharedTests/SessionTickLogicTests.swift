import XCTest
@testable import StillPointShared

/// #739 — the solo sit's per-tick decisions, held without a timer or a speaker.
///
/// `SessionTimerEngine` plays whatever `SessionTickLogic.advance` returns, so
/// these cases pin when each cue fires, which cues the final-minute voice
/// countdown silences, and what a resume must not replay.
final class SessionTickLogicTests: XCTestCase {

    private func prefs(
        tick: Bool = false,
        chime: Bool = false,
        completion: Bool = false,
        voice: Bool = false,
        haptics: Bool = false,
        interval: HapticCueLogic.Interval = .minute
    ) -> AudioEngine.SoundPrefs {
        AudioEngine.SoundPrefs(
            tick: tick,
            chime: chime,
            completion: completion,
            voiceCountdown: voice,
            haptics: haptics,
            hapticInterval: interval
        )
    }

    private func cursor(
        tick: Int,
        minuteBlock: Int,
        hapticInterval: Int,
        voice: Int = 0
    ) -> SessionTickLogic.Cursor {
        SessionTickLogic.Cursor(
            lastTickSec: tick,
            lastCompletedMinuteBlockIndex: minuteBlock,
            lastHapticIntervalIndex: hapticInterval,
            lastVoiceCountdownSec: voice
        )
    }

    private func advance(
        _ elapsed: Double,
        total: Int,
        prefs: AudioEngine.SoundPrefs,
        abandoned: Bool = false,
        cursor: SessionTickLogic.Cursor = .fresh
    ) -> SessionTickLogic.Outcome {
        SessionTickLogic.advance(
            to: elapsed,
            totalSeconds: total,
            prefs: prefs,
            isAbandoned: abandoned,
            cursor: cursor
        )
    }

    /// Ticks a whole sit at the timer's 0.05 s cadence until it completes, the
    /// way `SessionTimerEngine` drives it, and returns every tick's effects.
    private func simulateSit(total: Int, prefs: AudioEngine.SoundPrefs) -> [SessionTickLogic.Effects] {
        var cursor = SessionTickLogic.Cursor.fresh
        var effects: [SessionTickLogic.Effects] = []
        for step in 1...(total * 20) {
            // Dividing a whole step count keeps whole seconds exact; summing
            // 0.05 would drift across the boundaries these tests count.
            let outcome = advance(Double(step) / 20, total: total, prefs: prefs, cursor: cursor)
            cursor = outcome.cursor
            effects.append(outcome.effects)
            if outcome.completedNaturally { break }
        }
        return effects
    }

    // MARK: - Starting and resuming

    func testStartPicksUpAPausedOrRunningSit() {
        XCTAssertTrue(SessionTickLogic.isResume(pausedElapsed: 125.5, totalSeconds: 300, isPaused: true, isActive: false))
        // Paused before the first tick landed.
        XCTAssertTrue(SessionTickLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: true, isActive: false))
        // Started again while already running.
        XCTAssertTrue(SessionTickLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: false, isActive: true))
        // Clock part-way through, neither paused nor running.
        XCTAssertTrue(SessionTickLogic.isResume(pausedElapsed: 42, totalSeconds: 300, isPaused: false, isActive: false))
    }

    func testStartBeginsAgainForANewSitOrOnceTheClockHasRunOut() {
        XCTAssertFalse(SessionTickLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: false, isActive: false))
        XCTAssertFalse(SessionTickLogic.isResume(pausedElapsed: 300, totalSeconds: 300, isPaused: true, isActive: false))
        XCTAssertFalse(SessionTickLogic.isResume(pausedElapsed: 300, totalSeconds: 300, isPaused: false, isActive: true))
    }

    /// #848: Pause then End Early leaves a paused clock that `isResume` would
    /// pick back up, so an ended sit has to refuse the start before that.
    func testASitThatHasEndedNeverStartsAgain() {
        XCTAssertTrue(SessionTickLogic.isResume(pausedElapsed: 125.5, totalSeconds: 300, isPaused: true, isActive: false))
        // Ran out, or ended early.
        XCTAssertFalse(SessionTickLogic.canStart(isComplete: true, isAbandoned: false))
        // Abandoned.
        XCTAssertFalse(SessionTickLogic.canStart(isComplete: true, isAbandoned: true))
        XCTAssertFalse(SessionTickLogic.canStart(isComplete: false, isAbandoned: true))
    }

    func testASitThatHasNotEndedMayStart() {
        // Not yet begun, running, or paused.
        XCTAssertTrue(SessionTickLogic.canStart(isComplete: false, isAbandoned: false))
    }

    func testResumingSeedsEachCursorFromThePausedElapsedTime() {
        let resumed = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 60)
        XCTAssertEqual(resumed, cursor(tick: 130, minuteBlock: 1, hapticInterval: 2, voice: 0))

        let tenSecond = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 10)
        XCTAssertEqual(tenSecond.lastHapticIntervalIndex, 13)
    }

    func testAResumeDoesNotReplayCuesThatPlayedBeforeThePause() {
        let resumed = SessionTickLogic.Cursor.resuming(at: 130.4, totalSeconds: 260, hapticIntervalSeconds: 60)
        let outcome = advance(130.45, total: 260, prefs: prefs(tick: true, chime: true, haptics: true), cursor: resumed)

        XCTAssertFalse(outcome.effects.playTick)
        XCTAssertFalse(outcome.effects.playChime)
        XCTAssertNil(outcome.effects.haptic)
        XCTAssertEqual(outcome.cursor, resumed)
    }

    func testAResumeInsideTheFinalMinuteAnnouncesTheCurrentSecondAgain() {
        // Paused with 45 s left, after 45 had already been spoken.
        let resumed = SessionTickLogic.Cursor.resuming(at: 255, totalSeconds: 300, hapticIntervalSeconds: 60)
        XCTAssertEqual(resumed.lastVoiceCountdownSec, 0)

        let outcome = advance(255.02, total: 300, prefs: prefs(voice: true), cursor: resumed)
        XCTAssertEqual(outcome.effects.voiceCountdownSecond, 45)
    }

    // MARK: - Tick

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

    // MARK: - Minute bell

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

    // MARK: - Voice countdown

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

    // MARK: - Repeating haptic

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

    // MARK: - Completion

    func testTheTickThatReachesTheDurationEndsTheSitNaturally() {
        let before = cursor(tick: 299, minuteBlock: 3, hapticInterval: 4)
        let outcome = advance(
            300.03,
            total: 300,
            prefs: prefs(tick: true, chime: true, completion: true, haptics: true),
            cursor: before
        )

        XCTAssertTrue(outcome.completedNaturally)
        XCTAssertEqual(outcome.elapsed, 300)
        XCTAssertEqual(outcome.cursor, before)
        XCTAssertEqual(
            outcome.effects,
            SessionTickLogic.Effects(
                cancelVoiceCountdown: true,
                voiceCountdownSecond: nil,
                playTick: false,
                playChime: false,
                playCompletion: true,
                haptic: .sessionEnd
            )
        )
    }

    func testCompletionCuesFollowTheirOwnPreferences() {
        let silent = advance(300, total: 300, prefs: prefs())
        XCTAssertTrue(silent.completedNaturally)
        XCTAssertTrue(silent.effects.cancelVoiceCountdown)
        XCTAssertFalse(silent.effects.playCompletion)
        XCTAssertNil(silent.effects.haptic)

        // #712: silencing the completion sound must not silence the end buzz.
        let buzzOnly = advance(300, total: 300, prefs: prefs(haptics: true))
        XCTAssertFalse(buzzOnly.effects.playCompletion)
        XCTAssertEqual(buzzOnly.effects.haptic, .sessionEnd)

        // The completion sound still plays in voice countdown mode.
        let voiceMode = advance(300, total: 300, prefs: prefs(completion: true, voice: true))
        XCTAssertTrue(voiceMode.effects.playCompletion)
    }

    func testAnAbandonedSitGetsNoEndBuzz() {
        let outcome = advance(300, total: 300, prefs: prefs(haptics: true), abandoned: true)
        XCTAssertNil(outcome.effects.haptic)
    }

    func testATickShortOfTheDurationDoesNotEndTheSit() {
        let outcome = advance(
            299.99,
            total: 300,
            prefs: prefs(completion: true, haptics: true),
            cursor: cursor(tick: 299, minuteBlock: 3, hapticInterval: 4)
        )
        XCTAssertFalse(outcome.completedNaturally)
        XCTAssertEqual(outcome.elapsed, 299.99)
        XCTAssertFalse(outcome.effects.playCompletion)
        XCTAssertNil(outcome.effects.haptic)
    }

    func testABonusAddedBeforeTheEndKeepsTheSitRunning() {
        let outcome = advance(300.5, total: 330, prefs: prefs(completion: true))
        XCTAssertFalse(outcome.completedNaturally)
        XCTAssertEqual(outcome.elapsed, 300.5)
        XCTAssertFalse(outcome.effects.playCompletion)
    }

    // MARK: - A whole sit

    func testAThreeMinuteSitTicksEverySecondRingsTwiceAndCompletesOnce() {
        let effects = simulateSit(total: 180, prefs: prefs(tick: true, chime: true, completion: true))
        // Whole seconds 1 to 179; the 180th tick is the completing one.
        XCTAssertEqual(effects.filter(\.playTick).count, 179)
        // Bells at 60 and 120, each with at least a full minute to go.
        XCTAssertEqual(effects.filter(\.playChime).count, 2)
        XCTAssertEqual(effects.filter(\.playCompletion).count, 1)
        XCTAssertEqual(effects.last?.playCompletion, true)
    }
}
