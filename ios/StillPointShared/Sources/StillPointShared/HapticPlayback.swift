import Foundation

/// How a solo sit should vibrate while session audio is allowed to play (#794).
///
/// `UIImpactFeedbackGenerator` stays quiet once `AVAudioEngine` is running.
/// A normal sit starts that engine because the minute bell and the end sound
/// default to on, so the haptics toggle felt dead. Core Haptics with
/// haptics-only playback is the player that can run beside that engine.
/// UIKit feedback remains the fallback when the hardware has no Core Haptics.
public enum HapticPlayback {

    /// One Core Haptics event, free of CoreHaptics so `swift test` can hold it.
    public struct HapticEventSpec: Equatable, Sendable {
        public enum Kind: Equatable, Sendable {
            /// A single tap (`.hapticTransient`).
            case transient
            /// A sustained buzz (`.hapticContinuous`) lasting `duration` seconds.
            case continuous(duration: TimeInterval)
        }

        public let kind: Kind
        public let intensity: Float
        public let sharpness: Float
        public let relativeTime: TimeInterval

        public init(
            kind: Kind = .transient,
            intensity: Float,
            sharpness: Float,
            relativeTime: TimeInterval
        ) {
            self.kind = kind
            self.intensity = intensity
            self.sharpness = sharpness
            self.relativeTime = relativeTime
        }
    }

    /// The UIKit generator the fallback path plays for each strength.
    public enum FallbackFeedback: Equatable, Sendable {
        case lightImpact
        case heavyImpact
        /// #1179: the minute burst's taps — crisp and short, so a one-tap
        /// burst is not the ten-second buzz's heavy thud on fallback hardware.
        case rigidImpact
        case successNotification
    }

    /// True when the sit should use the player that coexists with session audio.
    public static func prefersCoreHaptics(hardwareSupportsCoreHaptics: Bool) -> Bool {
        hardwareSupportsCoreHaptics
    }

    /// #1175: a tiny tap for every second, a firm tap-plus-buzz for each
    /// ten-second mark, two strong taps for the end of the sit. #1179: a
    /// single crisp tap for one tap of the minute burst — the whole burst is
    /// `events(for: Firing)`. The shapes differ so they can be told apart with
    /// eyes closed.
    public static func events(for intensity: HapticCueLogic.Intensity) -> [HapticEventSpec] {
        switch intensity {
        case .pulse:
            return [HapticEventSpec(intensity: 0.45, sharpness: 0.3, relativeTime: 0)]
        case .marker:
            return [
                HapticEventSpec(intensity: 1.0, sharpness: 0.6, relativeTime: 0),
                HapticEventSpec(
                    kind: .continuous(duration: 0.18),
                    intensity: 0.8,
                    sharpness: 0.4,
                    relativeTime: 0
                ),
            ]
        case .burst:
            return [burstTap(at: 0)]
        case .pronounced:
            return [
                HapticEventSpec(intensity: 0.95, sharpness: 0.55, relativeTime: 0),
                HapticEventSpec(intensity: 1.0, sharpness: 0.85, relativeTime: 0.14),
            ]
        }
    }

    /// #1179: the pattern one firing plays. A minute burst is `taps` crisp
    /// taps, `HapticCueLogic.minuteBurst.tapSpacingSeconds` apart; every other
    /// cue plays its strength's shape once.
    public static func events(for firing: HapticCueLogic.Firing) -> [HapticEventSpec] {
        guard firing.cue == .minuteBurst else {
            return events(for: HapticCueLogic.intensity(for: firing.cue))
        }
        return burstOffsets(taps: firing.taps).map(burstTap(at:))
    }

    /// The UIKit fallback for hardware without Core Haptics.
    public static func fallback(for intensity: HapticCueLogic.Intensity) -> FallbackFeedback {
        switch intensity {
        case .pulse:      return .lightImpact
        case .marker:     return .heavyImpact
        case .burst:      return .rigidImpact
        case .pronounced: return .successNotification
        }
    }

    /// One fallback generator fire, `delay` seconds after the cue starts.
    public struct FallbackStep: Equatable, Sendable {
        public let feedback: FallbackFeedback
        public let delay: TimeInterval

        public init(feedback: FallbackFeedback, delay: TimeInterval) {
            self.feedback = feedback
            self.delay = delay
        }
    }

    /// #1179: the UIKit fallback for one firing — the burst's taps at the same
    /// spacing as its Core Haptics pattern, every other cue one fire now.
    public static func fallbackSteps(for firing: HapticCueLogic.Firing) -> [FallbackStep] {
        let feedback = fallback(for: HapticCueLogic.intensity(for: firing.cue))
        guard firing.cue == .minuteBurst else {
            return [FallbackStep(feedback: feedback, delay: 0)]
        }
        return burstOffsets(taps: firing.taps).map { FallbackStep(feedback: feedback, delay: $0) }
    }

    /// Onset of each burst tap, from the one tunable constant.
    private static func burstOffsets(taps: Int) -> [TimeInterval] {
        let spacing = HapticCueLogic.minuteBurst.tapSpacingSeconds
        return (0..<max(1, taps)).map { Double($0) * spacing }
    }

    /// A short, crisp transient near the marker's strength — sharper and a
    /// touch lighter than the end's taps, so a 2-tap burst does not read as
    /// the end.
    private static func burstTap(at relativeTime: TimeInterval) -> HapticEventSpec {
        HapticEventSpec(intensity: 0.85, sharpness: 1.0, relativeTime: relativeTime)
    }
}
