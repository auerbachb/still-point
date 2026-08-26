import Foundation

/// Persists the "just the timer" minimal session view preference (#669).
///
/// When enabled, the session screen collapses to the numeric countdown alone —
/// block grid, mind-state bar, tracking info, controls, and sound toggles all go
/// away — and the choice is restored on the next sit.
///
/// Mirrors web's `src/lib/minimalSessionViewPrefs.ts`, which reserves the iOS key
/// name as `IOS_MINIMAL_SESSION_VIEW_KEY` so both clients agree on it. Follows the
/// `SessionIntroPrefs` convention: a static enum over `UserDefaults.standard`
/// with an explicit reset for tests and UI-test reset paths.
public enum MinimalSessionViewPrefs {
    /// iOS UserDefaults key (parity with web localStorage naming style).
    public static let minimalSessionViewKey = "sp_minimalSessionView"

    /// `true` when the user chose to see only the timer during a sit.
    /// Defaults to `false`, so an untouched install gets the full session screen.
    public static var isMinimalSessionViewEnabled: Bool {
        UserDefaults.standard.bool(forKey: minimalSessionViewKey)
    }

    public static func setMinimalSessionViewEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: minimalSessionViewKey)
    }

    /// Wipes the persisted minimal-view preference. Used by tests and UI-test reset paths.
    public static func resetPersistedPrefs() {
        UserDefaults.standard.removeObject(forKey: minimalSessionViewKey)
    }
}
