import Foundation

/// One cue at a time: tick, haptic, or voice.
///
/// Chime and completion stay independent. This type only decides which of the
/// three mutually exclusive cues is active, and what an audio session must do
/// when the sitter switches.
public enum CueMode: String, Codable, CaseIterable, Sendable, Equatable {
    case tick
    case haptic
    case voice
}

public enum CueModeLogic {

    /// The mode implied by the three cue flags.
    ///
    /// Exactly one flag on keeps that mode. More than one prefers tick, then
    /// haptics, then voice. None becomes tick.
    public static func mode(of prefs: AudioEngine.SoundPrefs) -> CueMode {
        let tick = prefs.tick
        let haptic = prefs.haptics
        let voice = prefs.voiceCountdown
        let count = [tick, haptic, voice].filter { $0 }.count
        if count == 1 {
            if tick { return .tick }
            if haptic { return .haptic }
            return .voice
        }
        if tick || count == 0 { return .tick }
        if haptic { return .haptic }
        return .voice
    }

    /// Writes exactly one cue flag. Chime and completion are copied through.
    public static func applying(
        _ mode: CueMode,
        to prefs: AudioEngine.SoundPrefs
    ) -> AudioEngine.SoundPrefs {
        var next = prefs
        next.tick = mode == .tick
        next.haptics = mode == .haptic
        next.voiceCountdown = mode == .voice
        return next
    }

    /// Returns prefs with exactly one of tick, haptics, and voiceCountdown on.
    public static func normalized(_ prefs: AudioEngine.SoundPrefs) -> AudioEngine.SoundPrefs {
        applying(mode(of: prefs), to: prefs)
    }

    /// Tick, haptic, and voice are cue keys. Chime and completion are not.
    public static func mode(
        forTick isTick: Bool,
        haptics isHaptics: Bool,
        voice isVoice: Bool
    ) -> CueMode? {
        if isTick { return .tick }
        if isHaptics { return .haptic }
        if isVoice { return .voice }
        return nil
    }

    /// Audio side effects of moving from one exclusive mode to another.
    ///
    /// Enabling tick or voice warms the audio session. Haptic mode warms it
    /// only while the bell or the end sound is still on (#1176): those keep
    /// ringing in haptic mode, and must ring on time every minute. A haptic
    /// sit with both off stays silent and never activates the session (#712).
    /// Leaving voice cancels an in-flight clip and clears the announced-second
    /// dedup so a later re-enable in the same remaining second still speaks.
    public static func transitionEffects(
        from previous: AudioEngine.SoundPrefs,
        to next: AudioEngine.SoundPrefs
    ) -> SoundToggleLogic.Effects {
        let enabledTick = !previous.tick && next.tick
        let enabledVoice = !previous.voiceCountdown && next.voiceCountdown
        let disabledVoice = previous.voiceCountdown && !next.voiceCountdown
        let enabledAudibleHaptic = !previous.haptics && next.haptics && (next.chime || next.completion)
        return SoundToggleLogic.Effects(
            warmUp: enabledTick || enabledVoice || enabledAudibleHaptic,
            preloadVoiceCountdown: enabledVoice,
            cancelVoiceCountdown: disabledVoice,
            resetVoiceDedup: disabledVoice
        )
    }
}
