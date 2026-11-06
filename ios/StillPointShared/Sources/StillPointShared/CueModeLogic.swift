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

    /// #1176 (owner decision): whether the minute bell can ring under these
    /// prefs. Haptic mode means no minute bell, whatever the stored `chime`
    /// switch says. A gate, not a rewrite of the pref, so switching back to
    /// tick or voice brings the sitter's bell back. The end sound stays
    /// independent of cue mode.
    public static func minuteChimeApplies(to prefs: AudioEngine.SoundPrefs) -> Bool {
        mode(of: prefs) != .haptic
    }

    /// The minute bell as it will actually ring: the stored switch, gated by
    /// `minuteChimeApplies(to:)`.
    public static func minuteChimeEnabled(_ prefs: AudioEngine.SoundPrefs) -> Bool {
        prefs.chime && minuteChimeApplies(to: prefs)
    }

    /// Whether any sound these prefs can actually make is on: the tick, the
    /// bell where it applies, the end sound, or the voice countdown. Haptics is
    /// vibration and never counts (#712).
    public static func hasAudibleCue(_ prefs: AudioEngine.SoundPrefs) -> Bool {
        prefs.tick || minuteChimeEnabled(prefs) || prefs.completion || prefs.voiceCountdown
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
    /// only while the end sound is on (#1176): the minute bell does not ring in
    /// haptic mode (`minuteChimeApplies`), but the end sound still does. A
    /// haptic sit with the end sound off stays silent and never activates the
    /// session (#712).
    /// Leaving voice cancels an in-flight clip and clears the announced-second
    /// dedup so a later re-enable in the same remaining second still speaks.
    public static func transitionEffects(
        from previous: AudioEngine.SoundPrefs,
        to next: AudioEngine.SoundPrefs
    ) -> SoundToggleLogic.Effects {
        let enabledTick = !previous.tick && next.tick
        let enabledVoice = !previous.voiceCountdown && next.voiceCountdown
        let disabledVoice = previous.voiceCountdown && !next.voiceCountdown
        let enabledAudibleHaptic = !previous.haptics && next.haptics && next.completion
        return SoundToggleLogic.Effects(
            warmUp: enabledTick || enabledVoice || enabledAudibleHaptic,
            preloadVoiceCountdown: enabledVoice,
            cancelVoiceCountdown: disabledVoice,
            resetVoiceDedup: disabledVoice
        )
    }
}
