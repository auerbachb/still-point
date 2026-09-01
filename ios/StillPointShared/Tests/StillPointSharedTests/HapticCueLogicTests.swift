import XCTest
@testable import StillPointShared

/// #712 — vibration cues for a sitter who wants the sit marked by feel, not sound.
///
/// The acceptance criteria are all about *restraint*: off by default, silent
/// when the pref is off, silent after an abandon. Those are the cases worth
/// holding, so most of what follows asserts that nothing fires.
final class HapticCueLogicTests: XCTestCase {

    // MARK: - Minute marker

    func testMinuteMarkerFiresOnACompletedBlockWithAFullMinuteLeft() {
        XCTAssertEqual(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: true,
                fullMinuteRemains: true,
                isAbandoned: false
            ),
            .minuteMarker
        )
    }

    /// The headline requirement: haptics is opt-in, so a sit that never asked
    /// for it stays perfectly still even as every minute boundary goes by.
    func testMinuteMarkerStaysSilentWhenHapticsIsOff() {
        XCTAssertNil(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: false,
                crossedMinuteBoundary: true,
                fullMinuteRemains: true,
                isAbandoned: false
            )
        )
    }

    func testMinuteMarkerStaysSilentBetweenBoundaries() {
        XCTAssertNil(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: false,
                fullMinuteRemains: true,
                isAbandoned: false
            )
        )
    }

    /// Shares the bell's rule (#711): no marker once less than a full minute is
    /// left, so a buzz never lands seconds before the end cue and blurs into it.
    func testMinuteMarkerStaysSilentInsideTheFinalMinute() {
        XCTAssertNil(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: true,
                fullMinuteRemains: false,
                isAbandoned: false
            )
        )
    }

    func testMinuteMarkerStaysSilentAfterAnAbandon() {
        XCTAssertNil(
            HapticCueLogic.minuteMarkerCue(
                hapticsEnabled: true,
                crossedMinuteBoundary: true,
                fullMinuteRemains: true,
                isAbandoned: true
            )
        )
    }

    // MARK: - Session end

    func testSessionEndFiresWhenTheTimerRunsOutNaturally() {
        XCTAssertEqual(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: true,
                isAbandoned: false
            ),
            .sessionEnd
        )
    }

    func testSessionEndStaysSilentWhenHapticsIsOff() {
        XCTAssertNil(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: false,
                completedNaturally: true,
                isAbandoned: false
            )
        )
    }

    /// Ending early keeps the data but was the sitter's own choice — they know
    /// the sit is over and do not need to be told so by the phone. Mirrors the
    /// completion sound, which `endEarly()` also does not play.
    func testSessionEndStaysSilentWhenTheSitEndedEarly() {
        XCTAssertNil(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: false,
                isAbandoned: false
            )
        )
    }

    func testSessionEndStaysSilentAfterAnAbandon() {
        XCTAssertNil(
            HapticCueLogic.sessionEndCue(
                hapticsEnabled: true,
                completedNaturally: false,
                isAbandoned: true
            )
        )
    }

    // MARK: - Intensity

    /// The acceptance criterion the two-case enum exists for: with your eyes
    /// closed, the end of the sit has to feel unmistakably unlike a minute mark.
    func testTheEndOfASitNeverFeelsLikeAMinuteMarker() {
        XCTAssertNotEqual(
            HapticCueLogic.intensity(for: .minuteMarker),
            HapticCueLogic.intensity(for: .sessionEnd)
        )
    }

    func testMinuteMarkersAreTheGentlerOfTheTwo() {
        XCTAssertEqual(HapticCueLogic.intensity(for: .minuteMarker), .gentle)
        XCTAssertEqual(HapticCueLogic.intensity(for: .sessionEnd), .pronounced)
    }

    /// Every cue must resolve to an intensity — a new case added without a
    /// mapping would trap here rather than silently fire nothing on device.
    func testEveryCueResolvesToAnIntensity() {
        for cue in HapticCueLogic.Cue.allCases {
            XCTAssertTrue(
                HapticCueLogic.Intensity.allCases.contains(HapticCueLogic.intensity(for: cue)),
                "\(cue) has no intensity mapping"
            )
        }
    }
}
