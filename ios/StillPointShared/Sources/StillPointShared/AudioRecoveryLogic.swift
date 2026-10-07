import Foundation

/// Pure decision logic for recovering the shared `AudioEngine` after the system
/// disrupts audio mid-session (#710).
///
/// The per-second tick used to stop permanently the first time anything knocked
/// the audio session or the engine graph over — an interruption that ended
/// without `.shouldResume`, a headphone/Bluetooth route change, an engine
/// configuration change, or a media-services reset. A single failed
/// `AVAudioEngine.start()` was logged and then never retried, so one transient
/// event silenced the rest of the sit.
///
/// The decisions that drive recovery live here rather than in `AudioEngine` so
/// they are covered by `swift test` on macOS — the engine itself needs
/// AVFoundation and a real device.
public enum AudioRecoveryLogic {

    // MARK: - Route changes

    /// Mirror of `AVAudioSession.RouteChangeReason`.
    ///
    /// The raw values match the platform enum (`AVAudioSessionTypes.h`) but the
    /// engine maps AVFoundation's cases across explicitly, so this type never
    /// has to be trusted as an ABI contract.
    public enum RouteChangeReason: UInt, Equatable, CaseIterable {
        case unknown = 0
        case newDeviceAvailable = 1
        case oldDeviceUnavailable = 2
        case categoryChange = 3
        case override = 4
        case wakeFromSleep = 6
        case noSuitableRouteForCategory = 7
        case routeConfigurationChange = 8
    }

    /// Whether a route change should reactivate the audio session.
    ///
    /// Everything except `.categoryChange` reactivates: the session can be torn
    /// down when a device disappears (headphones unplugged, AirPods dropping
    /// out) and `setActive(true)` is idempotent, so reactivating more often than
    /// strictly necessary costs nothing while missing one silences the sit.
    ///
    /// `.categoryChange` is skipped because reconfiguring the session sets the
    /// category itself — acting on it would re-enter the same call.
    ///
    /// An unrecognized reason (`nil` — a value a future iOS adds) reactivates,
    /// so a new system behavior cannot leave the tick silent.
    public static func shouldReactivateSession(afterRouteChange reason: RouteChangeReason?) -> Bool {
        reason != .categoryChange
    }

    // MARK: - Render format

    /// Whether the main mixer's reported output format can be connected to.
    ///
    /// `AVAudioEngine.mainMixerNode.outputFormat(forBus:)` reports 0 Hz / 0
    /// channels while the audio session is inactive or the audio server has been
    /// reset. Connecting a source node with that format is invalid: the sound is
    /// silent at best, and the connection can raise instead. Callers repair the
    /// session and re-read the format rather than connecting with it.
    public static func isUsableRenderFormat(sampleRate: Double, channelCount: UInt32) -> Bool {
        guard channelCount > 0 else { return false }
        return sampleRate.isFinite && sampleRate > 0
    }

    // MARK: - Configuration changes

    /// Whether a configuration-change notification should discard the shared
    /// voice player node.
    ///
    /// Two `AVAudioEngine`s run in this process — the shared playback engine and
    /// `AmbientSoundManager`'s capture engine (#563) — and AVFoundation posts the
    /// affected engine as the notification's object. The observer is registered
    /// with `object: nil` so it survives `rebuildEngine()` replacing the engine,
    /// which means capture-engine notifications arrive here too; discarding the
    /// voice node for one of those would cut off an in-progress countdown clip
    /// even though our own graph is intact.
    ///
    /// `isFromOwnEngine == nil` means the notification carried no recognizable
    /// engine, and discards. Skipping recovery is the #710 failure itself —
    /// silence for the rest of the sit — while an unnecessary discard costs at
    /// most one re-created voice node.
    ///
    /// Reactivating the session is deliberately *not* gated on this: it is
    /// idempotent, and a format change reaching the capture engine affects the
    /// shared session either way.
    public static func shouldDiscardVoiceNode(onConfigurationChangeFromOwnEngine isFromOwnEngine: Bool?) -> Bool {
        isFromOwnEngine ?? true
    }

    // MARK: - Engine start failures

    /// What to do after an `AVAudioEngine.start()` attempt fails.
    public enum StartFailureRecovery: Equatable {
        /// Reactivate the audio session and try again — the overwhelmingly
        /// common cause is a session left inactive by an interruption, a route
        /// change, or backgrounding.
        case reactivateSessionAndRetry
        /// Reactivation is not helping. Replace the engine before the next sound
        /// so it plays through a fresh graph.
        case rebuildEngineBeforeNextSound
    }

    /// Number of consecutive failed `start()` attempts that escalates from
    /// "reactivate and retry" to a full engine rebuild.
    ///
    /// Each sound makes two attempts (one plain, one after reactivating), so
    /// this is two consecutive silent sounds — about two seconds of ticking.
    public static let startFailuresBeforeRebuild = 4

    /// Escalation policy for repeated engine-start failures.
    ///
    /// Recovery never gives up: ticks fire every second, so each one is a fresh
    /// attempt and audio returns within about a second of the disruption ending.
    public static func startFailureRecovery(consecutiveFailures: Int) -> StartFailureRecovery {
        consecutiveFailures >= startFailuresBeforeRebuild
            ? .rebuildEngineBeforeNextSound
            : .reactivateSessionAndRetry
    }

    // MARK: - Secondary-audio silence (#768)

    /// Mirror of `AVAudioSession.SilenceSecondaryAudioHintType`, plus the
    /// values this build does not recognize.
    ///
    /// With `.mixWithOthers`, iOS can mute this app as secondary audio when
    /// another app plays primary audio. That posts no interruption, and the
    /// engine keeps reporting `isRunning`, so a failed `start()` never happens
    /// and the #710 retry never runs. The tick then stays silent for the rest
    /// of the sit.
    public enum SecondaryAudioSilenceHint: Equatable {
        /// Another app started primary audio. Output is muted until it stops.
        case began
        /// The other audio stopped.
        case ended
        /// Missing userInfo, or a raw value this build does not know.
        case unrecognized
    }

    /// What to do when iOS posts a secondary-audio silence hint.
    public enum SecondaryAudioSilenceRecovery: Equatable {
        /// Rebuilding cannot unmute us while the other app is still primary.
        case waitForHintToEnd
        /// The engine may still be "running" and producing silence. Replace the
        /// graph before the next cue. Do not call `engine.start()` from the
        /// notification — the next play attaches a source node first (#262).
        case rebuildEngineBeforeNextSound
    }

    /// Fail toward recovery: an unrecognized hint rebuilds, same as hint-ended.
    /// Hint-began waits, because a rebuild during the mute cannot be heard.
    public static func secondaryAudioSilenceRecovery(
        for hint: SecondaryAudioSilenceHint
    ) -> SecondaryAudioSilenceRecovery {
        switch hint {
        case .began:
            return .waitForHintToEnd
        case .ended, .unrecognized:
            return .rebuildEngineBeforeNextSound
        }
    }

    /// Whether a cue may rebuild the graph or play.
    ///
    /// `mediaServicesWereLost` means the audio server is gone. Building an
    /// engine in that window produces another dead graph, and the cue that
    /// triggered the rebuild plays into it. Hold until `mediaServicesWereReset`
    /// clears the flag and rebuilds.
    public static func shouldPlayCue(mediaServicesLost: Bool) -> Bool {
        !mediaServicesLost
    }
}
