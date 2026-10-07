import XCTest
@testable import StillPointShared

final class HapticPlaybackTests: XCTestCase {

    func testCoreHapticsIsPreferredWhenTheHardwareSupportsIt() {
        XCTAssertTrue(HapticPlayback.prefersCoreHaptics(hardwareSupportsCoreHaptics: true))
    }

    func testSystemFeedbackIsTheFallbackWithoutCoreHaptics() {
        XCTAssertFalse(HapticPlayback.prefersCoreHaptics(hardwareSupportsCoreHaptics: false))
    }

    func testMinuteMarkerIsOneTapAndTheEndIsTwoStrongerTaps() {
        let minute = HapticPlayback.transients(for: .gentle)
        let end = HapticPlayback.transients(for: .pronounced)
        XCTAssertEqual(minute.count, 1)
        XCTAssertEqual(end.count, 2)
        XCTAssertGreaterThan(end[0].intensity, minute[0].intensity)
        XCTAssertNotEqual(minute, end)
    }
}
