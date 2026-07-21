import Foundation

/// Pure countdown-number selection logic for voice-countdown mode.
/// Mirrors the announce-second selection in web's BlockTimer.tsx.
/// Free of AVFoundation dependencies — testable on macOS with `swift test`.
public enum VoiceCountdownLogic {

    /// Returns the second value to announce for the given remaining time,
    /// or nil if the announcement should be suppressed (dedup or out of window).
    ///
    /// - Parameters:
    ///   - remaining: Remaining session time in seconds.
    ///   - lastAnnouncedSec: The most recently announced second (0 = none yet).
    /// - Returns: The second to announce (1–60), or nil if no new announcement is due.
    public static func announceSecond(remaining: Double, lastAnnouncedSec: Int) -> Int? {
        guard remaining > 0 && remaining <= 60 else { return nil }
        // Matches web: Math.ceil(remaining), clamped to 1–60.
        let candidate = max(1, min(60, Int(ceil(remaining))))
        guard candidate != lastAnnouncedSec else { return nil }
        return candidate
    }

    /// Returns true when remaining time has risen above 60 s and voice countdown
    /// state should be reset (e.g., bonus seconds were added mid-final-minute).
    public static func shouldReset(remaining: Double) -> Bool {
        remaining > 60
    }

    /// Returns true when the voice countdown window is active.
    public static func isActive(remaining: Double) -> Bool {
        remaining > 0 && remaining <= 60
    }
}
