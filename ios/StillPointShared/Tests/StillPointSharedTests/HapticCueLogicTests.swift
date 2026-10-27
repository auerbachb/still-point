import Foundation
import Testing
@testable import StillPointShared

/// #712 — vibration cues for a sitter who wants the sit marked by feel, not sound.
///
/// The acceptance criteria are all about *restraint*: off by default, silent
/// when the pref is off, silent after an abandon. Those are the cases worth
/// holding, so most of what follows asserts that nothing fires.
struct HapticCueLogicTests {

    // MARK: - Minute marker

    @Test func testMinuteMarkerFiresOnACompletedBlockWithAFullMinuteLeft() {
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: true,
                fullMinuteRemains: true,
                isAbandoned: false
            ) == .minuteMarker
        )
    }

    /// The headline requirement: haptics is opt-in, so a sit that never asked
    /// for it stays perfectly still even as every minute boundary goes by.
    @Test func testMinuteMarkerStaysSilentWhenHapticsIsOff() {
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: false,
                crossedMinuteBoundary: true,
                fullMinuteRemains: true,
                isAbandoned: false
            ) == nil
        )
    }

    @Test func testMinuteMarkerStaysSilentBetweenBoundaries() {
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: false,
                fullMinuteRemains: true,
                isAbandoned: false
            ) == nil
        )
    }

    /// Shares the bell's rule (#711): no marker once less than a full minute is
    /// left, so a buzz never lands seconds before the end cue and blurs into it.
    @Test func testMinuteMarkerStaysSilentInsideTheFinalMinute() {
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: true,
                fullMinuteRemains: false,
                isAbandoned: false
            ) == nil
        )
    }

    @Test func testMinuteMarkerStaysSilentAfterAnAbandon() {
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: true,
                fullMinuteRemains: true,
                isAbandoned: true
            ) == nil
        )
    }

    // MARK: - Session end

    @Test func testSessionEndFiresWhenTheTimerRunsOutNaturally() {
        #expect(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: true,
                isAbandoned: false
            ) == .sessionEnd
        )
    }

    @Test func testSessionEndStaysSilentWhenHapticsIsOff() {
        #expect(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: false,
                completedNaturally: true,
                isAbandoned: false
            ) == nil
        )
    }

    /// Ending early keeps the data but was the sitter's own choice — they know
    /// the sit is over and do not need to be told so by the phone. Mirrors the
    /// completion sound, which `endEarly()` also does not play.
    @Test func testSessionEndStaysSilentWhenTheSitEndedEarly() {
        #expect(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: false,
                isAbandoned: false
            ) == nil
        )
    }

    /// `completedNaturally` stays true so silence can only come from the abandon
    /// clause. Pairing it with `false` would duplicate the early-end case and
    /// leave `!isAbandoned` unpinned (#738).
    @Test func testSessionEndStaysSilentAfterAnAbandon() {
        #expect(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: true,
                isAbandoned: true
            ) == nil
        )
    }

    // MARK: - Intensity

    /// The acceptance criterion the two-case enum exists for: with your eyes
    /// closed, the end of the sit has to feel unmistakably unlike a minute mark.
    @Test func testTheEndOfASitNeverFeelsLikeAMinuteMarker() {
        #expect(HapticCueLogic.intensity(for: .minuteMarker) != HapticCueLogic.intensity(for: .sessionEnd))
    }

    @Test func testMinuteMarkersAreTheGentlerOfTheTwo() {
        #expect(HapticCueLogic.intensity(for: .minuteMarker) == .gentle)
        #expect(HapticCueLogic.intensity(for: .sessionEnd) == .pronounced)
    }

    /// Every cue must resolve to an intensity — a new case added without a
    /// mapping would trap here rather than silently fire nothing on device.
    @Test func testEveryCueResolvesToAnIntensity() {
        for cue in HapticCueLogic.Cue.allCases {
            #expect(
                HapticCueLogic.Intensity.allCases.contains(HapticCueLogic.intensity(for: cue)),
                "\(cue) has no intensity mapping"
            )
        }
    }

    // MARK: - Buddy timer signals (#736)

    /// A 10-minute sit crossing its first minute, with nine full minutes left.
    @Test func testBuddySignalsMarkAMinuteWhenAFullMinuteRemains() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 540,
            durationSeconds: 600,
            lastCompletedBlockIndex: -1,
            sessionEndAlreadyEmitted: false
        )
        #expect(signals.crossedMinuteBoundary)
        #expect(signals.fullMinuteRemains)
        #expect(!signals.completedNaturally)
        #expect(signals.updatedCompletedBlockIndex == 0)
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: signals.crossedMinuteBoundary,
                fullMinuteRemains: signals.fullMinuteRemains,
                isAbandoned: false
            ) == .minuteMarker
        )
    }

    @Test func testBuddySignalsStayQuietBetweenBoundaries() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 500,
            durationSeconds: 600,
            lastCompletedBlockIndex: 0,
            sessionEndAlreadyEmitted: false
        )
        #expect(!signals.crossedMinuteBoundary)
        #expect(!signals.fullMinuteRemains)
        #expect(!signals.completedNaturally)
    }

    /// Joining after the first minute has already completed must not replay it.
    @Test func testBuddySignalsDoNotReplayABoundaryAlreadyAccountedFor() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 540,
            durationSeconds: 600,
            lastCompletedBlockIndex: 0,
            sessionEndAlreadyEmitted: false
        )
        #expect(!signals.crossedMinuteBoundary)
        #expect(!signals.completedNaturally)
        #expect(signals.updatedCompletedBlockIndex == 0)
    }

    /// 150s sit: the second minute block ends with 30s left, inside the final
    /// minute, so the boundary is real and the marker must still stay silent.
    @Test func testBuddySignalsSuppressTheMarkerInsideTheFinalMinute() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 30,
            durationSeconds: 150,
            lastCompletedBlockIndex: 0,
            sessionEndAlreadyEmitted: false
        )
        #expect(signals.crossedMinuteBoundary)
        #expect(!signals.fullMinuteRemains)
        #expect(!signals.completedNaturally)
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: signals.crossedMinuteBoundary,
                fullMinuteRemains: signals.fullMinuteRemains,
                isAbandoned: false
            ) == nil
        )
    }

    @Test func testBuddySignalsCompleteNaturallyWhenRemainingHitsZero() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 0,
            durationSeconds: 600,
            lastCompletedBlockIndex: 8,
            sessionEndAlreadyEmitted: false
        )
        #expect(signals.completedNaturally)
        #expect(!signals.crossedMinuteBoundary)
        #expect(!signals.fullMinuteRemains)
        #expect(signals.sessionEndAlreadyEmitted)
        #expect(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: signals.completedNaturally,
                isAbandoned: false
            ) == .sessionEnd
        )
    }

    @Test func testBuddySignalsEmitNaturalCompletionOnlyOnce() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 0,
            durationSeconds: 600,
            lastCompletedBlockIndex: 8,
            sessionEndAlreadyEmitted: true
        )
        #expect(!signals.completedNaturally)
        #expect(!signals.crossedMinuteBoundary)
        #expect(signals.sessionEndAlreadyEmitted)
        #expect(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: signals.completedNaturally,
                isAbandoned: false
            ) == nil
        )
    }

    /// Leaving before the timer runs out — remaining still positive — is an
    /// early end, not a natural completion.
    @Test func testBuddySignalsDoNotCompleteWhileTimeRemains() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 15,
            durationSeconds: 600,
            lastCompletedBlockIndex: 8,
            sessionEndAlreadyEmitted: false
        )
        #expect(!signals.completedNaturally)
        #expect(!signals.crossedMinuteBoundary)
    }

    @Test func testBuddyNaturalCompletionStaysSilentWhenAbandoned() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 0,
            durationSeconds: 600,
            lastCompletedBlockIndex: 8,
            sessionEndAlreadyEmitted: false
        )
        #expect(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: signals.completedNaturally,
                isAbandoned: true
            ) == nil
        )
        #expect(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: true,
                fullMinuteRemains: true,
                isAbandoned: true
            ) == nil
        )
    }

    @Test func testBuddySignalsStayStillAfterCompletionIfTheClockBounces() {
        let signals = HapticCueLogic.buddyTimerCueSignals(
            remainingSeconds: 5,
            durationSeconds: 600,
            lastCompletedBlockIndex: 8,
            sessionEndAlreadyEmitted: true
        )
        #expect(!signals.crossedMinuteBoundary)
        #expect(!signals.fullMinuteRemains)
        #expect(!signals.completedNaturally)
        #expect(signals.sessionEndAlreadyEmitted)
        #expect(signals.updatedCompletedBlockIndex == 8)
    }
}
