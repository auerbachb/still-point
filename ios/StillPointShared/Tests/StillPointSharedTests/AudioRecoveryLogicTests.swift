import XCTest
@testable import StillPointShared

/// Coverage for the audio-recovery decisions behind #710 — the per-second tick
/// stopping mid-sit and never coming back.
final class AudioRecoveryLogicTests: XCTestCase {

    // MARK: - Route changes

    func testHeadphoneUnplugReactivatesSession() {
        // The reported "it just stopped" case: pulling headphones tears the route
        // down and leaves the session inactive.
        XCTAssertTrue(
            AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: .oldDeviceUnavailable)
        )
    }

    func testBluetoothConnectReactivatesSession() {
        XCTAssertTrue(
            AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: .newDeviceAvailable)
        )
    }

    func testCategoryChangeDoesNotReactivateSession() {
        // configureAudioSession() sets the category itself; reacting to the
        // resulting route change would re-enter it.
        XCTAssertFalse(
            AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: .categoryChange)
        )
    }

    func testEveryReasonExceptCategoryChangeReactivates() {
        for reason in AudioRecoveryLogic.RouteChangeReason.allCases {
            let expected = reason != .categoryChange
            XCTAssertEqual(
                AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: reason),
                expected,
                "unexpected decision for \(reason)"
            )
        }
    }

    func testUnrecognizedReasonReactivates() {
        // A reason a future iOS adds maps to nil. Failing toward recovery keeps a
        // new system behavior from silencing the tick.
        XCTAssertTrue(AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: nil))
    }

    func testRouteChangeReasonRawValuesMatchPlatformEnum() {
        // Documents the AVAudioSessionRouteChangeReason values this mirror tracks.
        // (5 is unused by the platform enum.)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.unknown.rawValue, 0)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.newDeviceAvailable.rawValue, 1)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.oldDeviceUnavailable.rawValue, 2)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.categoryChange.rawValue, 3)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.override.rawValue, 4)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.wakeFromSleep.rawValue, 6)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.noSuitableRouteForCategory.rawValue, 7)
        XCTAssertEqual(AudioRecoveryLogic.RouteChangeReason.routeConfigurationChange.rawValue, 8)
    }

    // MARK: - Render format

    func testTypicalHardwareFormatsAreUsable() {
        XCTAssertTrue(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 44100, channelCount: 2))
        XCTAssertTrue(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 48000, channelCount: 2))
        // Mono routes (receiver, some Bluetooth profiles) are still playable.
        XCTAssertTrue(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 16000, channelCount: 1))
    }

    func testInactiveSessionFormatIsRejected() {
        // What the main mixer reports while the session is inactive. Connecting a
        // source node with it produced silence instead of recovery.
        XCTAssertFalse(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 0, channelCount: 0))
    }

    func testZeroSampleRateIsRejectedEvenWithChannels() {
        XCTAssertFalse(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 0, channelCount: 2))
    }

    func testZeroChannelCountIsRejectedEvenWithSampleRate() {
        XCTAssertFalse(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 44100, channelCount: 0))
    }

    func testNonFiniteSampleRatesAreRejected() {
        XCTAssertFalse(
            AudioRecoveryLogic.isUsableRenderFormat(sampleRate: .nan, channelCount: 2)
        )
        XCTAssertFalse(
            AudioRecoveryLogic.isUsableRenderFormat(sampleRate: .infinity, channelCount: 2)
        )
        XCTAssertFalse(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: -44100, channelCount: 2))
    }

    // MARK: - Engine start failures

    func testFirstFailureReactivatesAndRetries() {
        XCTAssertEqual(
            AudioRecoveryLogic.startFailureRecovery(consecutiveFailures: 1),
            .reactivateSessionAndRetry
        )
    }

    func testFailuresBelowThresholdKeepRetrying() {
        for failures in 0..<AudioRecoveryLogic.startFailuresBeforeRebuild {
            XCTAssertEqual(
                AudioRecoveryLogic.startFailureRecovery(consecutiveFailures: failures),
                .reactivateSessionAndRetry,
                "unexpected escalation at \(failures) failures"
            )
        }
    }

    func testThresholdEscalatesToEngineRebuild() {
        // Two consecutive silent sounds (two start attempts each) — reactivation
        // is not clearing it, so the graph itself is replaced.
        XCTAssertEqual(
            AudioRecoveryLogic.startFailureRecovery(
                consecutiveFailures: AudioRecoveryLogic.startFailuresBeforeRebuild
            ),
            .rebuildEngineBeforeNextSound
        )
    }

    func testRecoveryNeverGivesUpAfterManyFailures() {
        // No terminal "stay silent" state: every later tick still attempts a
        // rebuild, so audio returns as soon as the disruption clears.
        XCTAssertEqual(
            AudioRecoveryLogic.startFailureRecovery(consecutiveFailures: 500),
            .rebuildEngineBeforeNextSound
        )
    }

    func testRebuildThresholdIsTwoSilentSounds() {
        // Each sound makes one plain start attempt and one after reactivating.
        XCTAssertEqual(AudioRecoveryLogic.startFailuresBeforeRebuild, 4)
    }
}
