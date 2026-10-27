import Foundation
import Testing
@testable import StillPointShared

struct HapticPlaybackTests {

    @Test func testCoreHapticsIsPreferredWhenTheHardwareSupportsIt() {
        #expect(HapticPlayback.prefersCoreHaptics(hardwareSupportsCoreHaptics: true))
    }

    @Test func testSystemFeedbackIsTheFallbackWithoutCoreHaptics() {
        #expect(!HapticPlayback.prefersCoreHaptics(hardwareSupportsCoreHaptics: false))
    }

    @Test func testMinuteMarkerIsOneTapAndTheEndIsTwoStrongerTaps() {
        let minute = HapticPlayback.transients(for: .gentle)
        let end = HapticPlayback.transients(for: .pronounced)
        #expect(minute.count == 1)
        #expect(end.count == 2)
        #expect(end[0].intensity > minute[0].intensity)
        #expect(minute != end)
    }
}
