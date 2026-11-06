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

    /// #1175: the every-second pulse is today's tiny tap, unchanged.
    @Test func testThePulseIsTheOriginalSingleLightTap() {
        let pulse = HapticPlayback.events(for: .pulse)
        #expect(pulse == [
            HapticPlayback.HapticEventSpec(intensity: 0.45, sharpness: 0.3, relativeTime: 0),
        ])
    }

    /// #1175: the minute / ten-second marker is clearly stronger than the
    /// pulse — a full-strength tap plus a short sustained buzz.
    @Test func testTheMarkerIsWellAboveThePulse() {
        let marker = HapticPlayback.events(for: .marker)
        let pulse = HapticPlayback.events(for: .pulse)
        let markerPeak = marker.map(\.intensity).max() ?? 0
        #expect(markerPeak >= 0.9)
        #expect(markerPeak > (pulse.map(\.intensity).max() ?? 0) + 0.4)
        #expect(marker.contains { spec in
            if case .continuous(let duration) = spec.kind { return duration > 0 }
            return false
        })
        #expect(marker != pulse)
    }

    /// The end stays its two-tap shape, at least as strong as before, and
    /// unlike both repeating cues.
    @Test func testTheEndIsDistinctFromThePulseAndTheMarker() {
        let end = HapticPlayback.events(for: .pronounced)
        #expect(end.count == 2)
        #expect(end.allSatisfy { $0.kind == .transient })
        #expect(end[0].intensity >= 0.95)
        #expect(end[1].intensity >= 1.0)
        #expect(end != HapticPlayback.events(for: .marker))
        #expect(end != HapticPlayback.events(for: .pulse))
    }

    @Test func testFallbackMapsEachStrengthToItsOwnGenerator() {
        #expect(HapticPlayback.fallback(for: .pulse) == .lightImpact)
        #expect(HapticPlayback.fallback(for: .marker) == .heavyImpact)
        #expect(HapticPlayback.fallback(for: .pronounced) == .successNotification)
    }
}
