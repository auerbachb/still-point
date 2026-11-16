import Foundation

/// Persists the local timer display preferences (#1190, sand-carrier timer).
///
/// `sandAnimation` is the opt-in sand-carrier display for solo sits. It mirrors
/// web's `sandAnimation` field in `src/lib/displayPrefs.ts`, and it is local only,
/// like the minimal session view preference it sits beside (`MinimalSessionViewPrefs`).
/// Off by default, so an untouched install keeps the digits.
///
/// Follows the `MinimalSessionViewPrefs` convention: a static enum over
/// `UserDefaults.standard` with an explicit reset for tests and UI-test reset paths.
public enum TimerDisplayPrefs {
    /// iOS UserDefaults key for the sand-carrier display (parity with the web field name).
    public static let sandAnimationKey = "sp_sandAnimation"

    /// `true` when the user chose the sand-carrier display for solo sits.
    public static var isSandAnimationEnabled: Bool {
        UserDefaults.standard.bool(forKey: sandAnimationKey)
    }

    public static func setSandAnimationEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: sandAnimationKey)
    }

    /// Wipes the persisted timer display preferences. Used by tests and UI-test reset paths.
    public static func resetPersistedPrefs() {
        UserDefaults.standard.removeObject(forKey: sandAnimationKey)
    }
}
