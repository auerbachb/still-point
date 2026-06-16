import Foundation

// MARK: - Breath Phase

/// Which side of a breath the user is on.
///
/// Phase semantics: taps alternate inhale / exhale.
///   - tap 1 → registers the first inhale  → tapCount becomes 1 (odd) → phase becomes .exhale (waiting for exhale)
///   - tap 2 → registers first exhale      → tapCount becomes 2 (even) → phase becomes .inhale (one full breath done)
///   - tap 3 → registers second inhale     → tapCount becomes 3 (odd) → phase becomes .exhale
///   …
/// So `phase(forTaps:)` returns the *next expected* action:
///   even tapCount (incl. 0) → .inhale  (next tap should be an inhale)
///   odd  tapCount            → .exhale  (just inhaled, now exhale)
public enum BreathPhase {
    case inhale
    case exhale
}

// MARK: - BreathCounting

public enum BreathCounting {

    /// Number of complete breaths (1 breath = 1 inhale + 1 exhale = 2 taps).
    public static func breathCount(forTaps taps: Int) -> Int {
        taps / 2
    }

    /// The *next expected* breath phase given how many taps have been recorded.
    ///
    /// - Even tapCount (0, 2, 4, …): inhale is next.
    /// - Odd tapCount (1, 3, 5, …): exhale is next.
    public static func phase(forTaps taps: Int) -> BreathPhase {
        taps % 2 == 0 ? .inhale : .exhale
    }

    /// Elapsed whole seconds since `start`, clamped to a minimum of 0.
    ///
    /// Uses wall-clock difference so it survives backgrounding without drift.
    public static func elapsedSeconds(since start: Date, now: Date = Date()) -> Int {
        max(0, Int(now.timeIntervalSince(start)))
    }

    /// Format a second count as "M:SS" or "MM:SS".
    ///
    /// Examples:
    ///   0   → "0:00"
    ///   65  → "1:05"
    ///   600 → "10:00"
    public static func elapsedDisplay(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let minutes = s / 60
        let secs = s % 60
        return "\(minutes):\(String(format: "%02d", secs))"
    }
}
