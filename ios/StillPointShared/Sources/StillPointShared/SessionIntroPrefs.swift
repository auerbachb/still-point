import Foundation

/// Persists whether the pre-session intro overlay is permanently hidden (#560).
///
/// When hidden, the overlay is skipped on every subsequent session until the user
/// re-enables it from Settings.
public enum SessionIntroPrefs {
    /// iOS UserDefaults key (parity with web localStorage naming style).
    public static let hideIntroOverlayKey = "sp_hideSessionIntroOverlay"

    /// `true` when the user chose "Don't show again" on the session intro overlay.
    public static var isIntroOverlayHidden: Bool {
        UserDefaults.standard.bool(forKey: hideIntroOverlayKey)
    }

    public static func setIntroOverlayHidden(_ hidden: Bool) {
        UserDefaults.standard.set(hidden, forKey: hideIntroOverlayKey)
    }

    /// Wipes the persisted intro preference. Used by UI-test reset paths.
    public static func resetPersistedPrefs() {
        UserDefaults.standard.removeObject(forKey: hideIntroOverlayKey)
    }
}
