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
        case successNotification
    }

    /// True when the sit should use the player that coexists with session audio.
    public static func prefersCoreHaptics(hardwareSupportsCoreHaptics: Bool) -> Bool {
        hardwareSupportsCoreHaptics
    }

    /// #1175: a tiny tap for every second, a firm tap-plus-buzz for each
    /// minute or ten-second mark, two strong taps for the end of the sit.
    /// The shapes differ so they can be told apart with eyes closed.
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
        case .pronounced:
            return [
                HapticEventSpec(intensity: 0.95, sharpness: 0.55, relativeTime: 0),
                HapticEventSpec(intensity: 1.0, sharpness: 0.85, relativeTime: 0.14),
            ]
        }
    }

    /// The UIKit fallback for hardware without Core Haptics.
    public static func fallback(for intensity: HapticCueLogic.Intensity) -> FallbackFeedback {
        switch intensity {
        case .pulse:      return .lightImpact
        case .marker:     return .heavyImpact
        case .pronounced: return .successNotification
        }
    }
}
