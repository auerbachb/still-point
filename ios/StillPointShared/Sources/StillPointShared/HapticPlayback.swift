import Foundation

/// How a solo sit should vibrate while session audio is allowed to play (#794).
///
/// `UIImpactFeedbackGenerator` stays quiet once `AVAudioEngine` is running.
/// A normal sit starts that engine because the minute bell and the end sound
/// default to on, so the haptics toggle felt dead. Core Haptics with
/// haptics-only playback is the player that can run beside that engine.
/// UIKit feedback remains the fallback when the hardware has no Core Haptics.
public enum HapticPlayback {

    public struct Transient: Equatable, Sendable {
        public let intensity: Float
        public let sharpness: Float
        public let relativeTime: TimeInterval

        public init(intensity: Float, sharpness: Float, relativeTime: TimeInterval) {
            self.intensity = intensity
            self.sharpness = sharpness
            self.relativeTime = relativeTime
        }
    }

    /// True when the sit should use the player that coexists with session audio.
    public static func prefersCoreHaptics(hardwareSupportsCoreHaptics: Bool) -> Bool {
        hardwareSupportsCoreHaptics
    }

    /// One light tap for a minute, two stronger taps for the end of the sit.
    /// The shapes differ so they can be told apart with eyes closed.
    public static func transients(for intensity: HapticCueLogic.Intensity) -> [Transient] {
        switch intensity {
        case .gentle:
            return [Transient(intensity: 0.45, sharpness: 0.3, relativeTime: 0)]
        case .pronounced:
            return [
                Transient(intensity: 0.95, sharpness: 0.55, relativeTime: 0),
                Transient(intensity: 1.0, sharpness: 0.85, relativeTime: 0.14),
            ]
        }
    }
}
