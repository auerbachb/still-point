import Foundation
import Testing
@testable import StillPointShared

/// Coverage for the audio-recovery decisions behind #710 — the per-second tick
/// stopping mid-sit and never coming back.
struct AudioRecoveryLogicTests {

    // MARK: - Route changes

    @Test func testHeadphoneUnplugReactivatesSession() {
        // The reported "it just stopped" case: pulling headphones tears the route
        // down and leaves the session inactive.
        #expect(AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: .oldDeviceUnavailable))
    }

    @Test func testBluetoothConnectReactivatesSession() {
        #expect(AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: .newDeviceAvailable))
    }

    @Test func testCategoryChangeDoesNotReactivateSession() {
        // configureAudioSession() sets the category itself; reacting to the
        // resulting route change would re-enter it.
        #expect(!AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: .categoryChange))
    }

    @Test func testEveryReasonExceptCategoryChangeReactivates() {
        for reason in AudioRecoveryLogic.RouteChangeReason.allCases {
            let expected = reason != .categoryChange
            #expect(
                AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: reason) == expected,
                "unexpected decision for \(reason)"
            )
        }
    }

    @Test func testUnrecognizedReasonReactivates() {
        // A reason a future iOS adds maps to nil. Failing toward recovery keeps a
        // new system behavior from silencing the tick.
        #expect(AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: nil))
    }

    @Test func testRouteChangeReasonRawValuesMatchPlatformEnum() {
        // Documents the AVAudioSessionRouteChangeReason values this mirror tracks.
        // (5 is unused by the platform enum.)
        #expect(AudioRecoveryLogic.RouteChangeReason.unknown.rawValue == 0)
        #expect(AudioRecoveryLogic.RouteChangeReason.newDeviceAvailable.rawValue == 1)
        #expect(AudioRecoveryLogic.RouteChangeReason.oldDeviceUnavailable.rawValue == 2)
        #expect(AudioRecoveryLogic.RouteChangeReason.categoryChange.rawValue == 3)
        #expect(AudioRecoveryLogic.RouteChangeReason.override.rawValue == 4)
        #expect(AudioRecoveryLogic.RouteChangeReason.wakeFromSleep.rawValue == 6)
        #expect(AudioRecoveryLogic.RouteChangeReason.noSuitableRouteForCategory.rawValue == 7)
        #expect(AudioRecoveryLogic.RouteChangeReason.routeConfigurationChange.rawValue == 8)
    }

    // MARK: - Render format

    @Test func testTypicalHardwareFormatsAreUsable() {
        #expect(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 44100, channelCount: 2))
        #expect(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 48000, channelCount: 2))
        // Mono routes (receiver, some Bluetooth profiles) are still playable.
        #expect(AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 16000, channelCount: 1))
    }

    @Test func testInactiveSessionFormatIsRejected() {
        // What the main mixer reports while the session is inactive. Connecting a
        // source node with it produced silence instead of recovery.
        #expect(!AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 0, channelCount: 0))
    }

    @Test func testZeroSampleRateIsRejectedEvenWithChannels() {
        #expect(!AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 0, channelCount: 2))
    }

    @Test func testZeroChannelCountIsRejectedEvenWithSampleRate() {
        #expect(!AudioRecoveryLogic.isUsableRenderFormat(sampleRate: 44100, channelCount: 0))
    }

    @Test func testNonFiniteSampleRatesAreRejected() {
        #expect(!AudioRecoveryLogic.isUsableRenderFormat(sampleRate: .nan, channelCount: 2))
        #expect(!AudioRecoveryLogic.isUsableRenderFormat(sampleRate: .infinity, channelCount: 2))
        #expect(!AudioRecoveryLogic.isUsableRenderFormat(sampleRate: -44100, channelCount: 2))
    }

    // MARK: - Configuration changes

    @Test func testOwnEngineConfigurationChangeDiscardsVoiceNode() {
        #expect(AudioRecoveryLogic.shouldDiscardVoiceNode(onConfigurationChangeFromOwnEngine: true))
    }

    /// The capture engine (#563) posts its own configuration changes. Acting on
    /// one would stop an in-progress countdown clip while our graph is intact.
    @Test func testCaptureEngineConfigurationChangeKeepsVoiceNode() {
        #expect(!AudioRecoveryLogic.shouldDiscardVoiceNode(onConfigurationChangeFromOwnEngine: false))
    }

    /// Unknown sender discards: skipping recovery is the #710 failure itself,
    /// while an unnecessary discard costs one re-created voice node.
    @Test func testUnrecognizedConfigurationChangeSenderDiscardsVoiceNode() {
        #expect(AudioRecoveryLogic.shouldDiscardVoiceNode(onConfigurationChangeFromOwnEngine: nil))
    }

    // MARK: - Engine start failures

    @Test func testFirstFailureReactivatesAndRetries() {
        #expect(AudioRecoveryLogic.startFailureRecovery(consecutiveFailures: 1) == .reactivateSessionAndRetry)
    }

    @Test func testFailuresBelowThresholdKeepRetrying() {
        for failures in 0..<AudioRecoveryLogic.startFailuresBeforeRebuild {
            #expect(
                AudioRecoveryLogic.startFailureRecovery(consecutiveFailures: failures) == .reactivateSessionAndRetry,
                "unexpected escalation at \(failures) failures"
            )
        }
    }

    @Test func testThresholdEscalatesToEngineRebuild() {
        // Two consecutive silent sounds (two start attempts each) — reactivation
        // is not clearing it, so the graph itself is replaced.
        #expect(
            AudioRecoveryLogic.startFailureRecovery(
                consecutiveFailures: AudioRecoveryLogic.startFailuresBeforeRebuild
            ) == .rebuildEngineBeforeNextSound
        )
    }

    @Test func testRecoveryNeverGivesUpAfterManyFailures() {
        // No terminal "stay silent" state: every later tick still attempts a
        // rebuild, so audio returns as soon as the disruption clears.
        #expect(AudioRecoveryLogic.startFailureRecovery(consecutiveFailures: 500) == .rebuildEngineBeforeNextSound)
    }

    // MARK: - Secondary-audio silence (#768)

    @Test func testSilenceHintBeganWaits() {
        #expect(AudioRecoveryLogic.secondaryAudioSilenceRecovery(for: .began) == .waitForHintToEnd)
    }

    @Test func testSilenceHintEndedReplacesTheEngineBeforeTheNextSound() {
        // The engine can still report isRunning while iOS has muted secondary
        // audio, so waiting for a failed start() never fires.
        #expect(AudioRecoveryLogic.secondaryAudioSilenceRecovery(for: .ended) == .rebuildEngineBeforeNextSound)
    }

    @Test func testCueIsHeldWhileMediaServicesAreLost() {
        #expect(!AudioRecoveryLogic.shouldPlayCue(mediaServicesLost: true))
    }

    @Test func testCuePlaysOnceMediaServicesAreBack() {
        #expect(AudioRecoveryLogic.shouldPlayCue(mediaServicesLost: false))
    }

    @Test func testUnrecognizedSilenceHintFailsTowardRecovery() {
        #expect(AudioRecoveryLogic.secondaryAudioSilenceRecovery(for: .unrecognized) == .rebuildEngineBeforeNextSound)
    }

    @Test func testRebuildThresholdIsTwoSilentSounds() {
        // Each sound makes one plain start attempt and one after reactivating.
        #expect(AudioRecoveryLogic.startFailuresBeforeRebuild == 4)
    }
}
