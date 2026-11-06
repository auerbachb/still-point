import Foundation
import Testing
@testable import StillPointShared

/// #1176 — a sit's sounds play on time or not at all.
struct CueDeliveryLogicTests: SessionTickLogicTestSupport {

    private let second: UInt64 = 1_000_000_000

    // MARK: - The tick loop's minute bell

    @Test func testABellOwedOnTimeStillStrikes() {
        let outcome = advance(61.4, total: 600, prefs: prefs(tick: true, chime: true))
        #expect(outcome.effects.playChime)
    }

    /// The report's clock jump: the app slept through minutes 1–3 and the first
    /// tick back lands at 3:47. The bell for minute 3 is 47 s late — dropped,
    /// and the cursor still moves so the next minute is not replayed either.
    /// Run in tick mode, since haptic mode no longer rings the bell at all.
    @Test func testABellOwedAfterAClockJumpIsDroppedNotStruckLate() {
        let outcome = advance(
            227,
            total: 600,
            prefs: prefs(tick: true, chime: true),
            cursor: cursor(tick: 0, minuteBlock: 0, hapticInterval: 1)
        )
        #expect(!outcome.effects.playChime)
        #expect(outcome.cursor.lastCompletedMinuteBlockIndex == 2)

        let nextMinute = advance(240.03, total: 600, prefs: prefs(tick: true, chime: true), cursor: outcome.cursor)
        #expect(nextMinute.effects.playChime)
    }

    // MARK: - Haptic mode rings no minute bell (owner decision)

    /// Haptic mode means no minute bell, whatever the stored switch says. The
    /// cursor still moves, so switching to tick later does not replay it.
    @Test func testHapticModeNeverRingsTheMinuteBell() {
        let haptic = prefs(chime: true, haptics: true)
        let outcome = advance(60.02, total: 600, prefs: haptic)
        #expect(!outcome.effects.playChime)
        #expect(outcome.effects.haptic != nil)
        #expect(outcome.cursor.lastCompletedMinuteBlockIndex == 0)
        #expect(haptic.chime, "the gate leaves the stored pref alone")

        let wholeSit = simulateSit(total: 300, prefs: haptic)
        #expect(!wholeSit.contains { $0.playChime })
    }

    /// The stored bell survives the haptic gate: back in tick mode it rings.
    @Test func testTickModeStillRingsTheStoredBell() {
        let haptic = prefs(chime: true, haptics: true)
        let tick = CueModeLogic.applying(.tick, to: haptic)
        #expect(tick.chime)
        #expect(advance(60.02, total: 600, prefs: tick).effects.playChime)
        #expect(!CueModeLogic.minuteChimeApplies(to: haptic))
        #expect(CueModeLogic.minuteChimeApplies(to: tick))
        #expect(CueModeLogic.minuteChimeApplies(to: CueModeLogic.applying(.voice, to: haptic)))
    }

    /// With the bell gated out, a haptic sit's only possible sound is the end.
    @Test func testHasAudibleCueIgnoresTheGatedBell() {
        #expect(!CueModeLogic.hasAudibleCue(prefs(chime: true, haptics: true)))
        #expect(CueModeLogic.hasAudibleCue(prefs(chime: true, completion: true, haptics: true)))
        #expect(CueModeLogic.hasAudibleCue(prefs(chime: true)))
    }

    // MARK: - The end sound (owner decision)

    @Test func testAnOnTimeEndSoundPlays() {
        let outcome = advance(300.04, total: 300, prefs: prefs(completion: true, haptics: true))
        #expect(outcome.completedNaturally)
        #expect(outcome.effects.playCompletion)
    }

    /// The app slept through the end and the first tick back is past the
    /// budget: the end sound is dropped, the end buzz and the completion land.
    @Test func testALateEndSoundIsDroppedButTheSitStillEnds() {
        let outcome = advance(
            300 + CueDeliveryLogic.maxLatenessSeconds + 0.01,
            total: 300,
            prefs: prefs(completion: true, haptics: true)
        )
        #expect(outcome.completedNaturally)
        #expect(outcome.elapsed == 300)
        #expect(!outcome.effects.playCompletion)
        #expect(outcome.effects.haptic == .sessionEnd)

        let atBudget = advance(300 + CueDeliveryLogic.maxLatenessSeconds, total: 300, prefs: prefs(completion: true))
        #expect(atBudget.effects.playCompletion)
    }

    @Test func testTheLatenessBudgetIsInclusiveAndThenDrops() {
        #expect(CueDeliveryLogic.isOnTime(dueAt: 60, now: 60 + CueDeliveryLogic.maxLatenessSeconds))
        #expect(!CueDeliveryLogic.isOnTime(dueAt: 60, now: 60 + CueDeliveryLogic.maxLatenessSeconds + 0.01))
        #expect(CueDeliveryLogic.minuteBellDueAt(completedBlockIndex: 2) == 180)
    }

    // MARK: - The engine's render gate

    @Test func testASoundStartingWithinTheBudgetRenders() {
        #expect(CueDeliveryLogic.shouldRenderSynthesizedCue(
            requestedAtNanos: 10 * second,
            nowNanos: 10 * second + second / 20,
            hasStarted: false,
            durationSeconds: 0.25
        ))
    }

    /// A chime attached while the engine was down, pulled when a later start
    /// brings the engine back minutes after, renders silence.
    @Test func testASoundFirstPulledLongAfterItsRequestIsSilenced() {
        #expect(!CueDeliveryLogic.shouldRenderSynthesizedCue(
            requestedAtNanos: 10 * second,
            nowNanos: 190 * second,
            hasStarted: false,
            durationSeconds: 0.25
        ))
    }

    /// A strike paused mid-decay must not resume as a headless fragment.
    @Test func testAStartedSoundMayFinishButNotResumeLater() {
        #expect(CueDeliveryLogic.shouldRenderSynthesizedCue(
            requestedAtNanos: 0,
            nowNanos: 2 * second,
            hasStarted: true,
            durationSeconds: 2.5
        ))
        #expect(!CueDeliveryLogic.shouldRenderSynthesizedCue(
            requestedAtNanos: 0,
            nowNanos: 60 * second,
            hasStarted: true,
            durationSeconds: 0.25
        ))
    }

    @Test func testAClockReadBeforeTheRequestCountsAsOnTime() {
        #expect(CueDeliveryLogic.shouldRenderSynthesizedCue(
            requestedAtNanos: 10 * second,
            nowNanos: 5 * second,
            hasStarted: false,
            durationSeconds: 0.25
        ))
    }

    // MARK: - Render format after a rebuild or route change

    @Test func testAMixerAtTheHardwareRateMatches() {
        #expect(CueDeliveryLogic.renderFormatMatchesHardware(mixerSampleRate: 48_000, hardwareSampleRate: 48_000))
    }

    @Test func testAStaleMixerRateIsAMismatch() {
        #expect(!CueDeliveryLogic.renderFormatMatchesHardware(mixerSampleRate: 44_100, hardwareSampleRate: 48_000))
    }

    @Test func testAnUnknownRateIsLeftToTheUsableFormatCheck() {
        #expect(CueDeliveryLogic.renderFormatMatchesHardware(mixerSampleRate: 0, hardwareSampleRate: 48_000))
        #expect(CueDeliveryLogic.renderFormatMatchesHardware(mixerSampleRate: 48_000, hardwareSampleRate: 0))
    }
}
