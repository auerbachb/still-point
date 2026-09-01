import Foundation

/// Persists whether the device screen stays awake during an active sit (#306, #730).
///
/// #730 flipped this from opt-in to opt-out: an install that has never touched the
/// setting keeps the screen awake for the length of a sit. `UserDefaults.bool(forKey:)`
/// cannot express that, because it collapses "never set" into `false` — so reads go
/// through `object(forKey:) as? Bool` and `resolveKeepScreenAwake(stored:)`, leaving an
/// explicit `false` intact forever. No migration writes anything: absence *is* the
/// unset signal.
///
/// Mirrors web's `src/lib/wakeLockPrefs.ts`, where the absence of the
/// `stillpoint_wake_lock_prefs` localStorage key plays the same role. Follows the
/// `MinimalSessionViewPrefs` / `SessionIntroPrefs` convention: a static enum over
/// `UserDefaults.standard` with an explicit reset for tests and UI-test reset paths.
public enum WakeLockPrefs {
    /// iOS UserDefaults key (parity with web localStorage naming style).
    public static let keepScreenAwakeKey = "sp_keepScreenAwakeDuringSession"

    /// Resolved value for an install that has never touched the setting (#730).
    public static let defaultKeepScreenAwake = true

    /// Pure resolver: `nil` (never set) takes the default; an explicit choice — `false`
    /// included — is returned untouched. A value of some other type reads back as `nil`
    /// here and therefore takes the default, matching web's invalid-shape fallback.
    public static func resolveKeepScreenAwake(stored: Bool?) -> Bool {
        stored ?? defaultKeepScreenAwake
    }

    /// The raw stored choice, or `nil` when the user has never touched the setting.
    public static var storedKeepScreenAwake: Bool? {
        UserDefaults.standard.object(forKey: keepScreenAwakeKey) as? Bool
    }

    /// `true` when the screen should stay awake for the duration of an active sit.
    public static var isKeepScreenAwakeEnabled: Bool {
        resolveKeepScreenAwake(stored: storedKeepScreenAwake)
    }

    /// Records an explicit choice. Writing `false` is what makes the opt-out stick.
    public static func setKeepScreenAwakeEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: keepScreenAwakeKey)
    }

    /// Wipes the persisted choice, returning the install to the unset default.
    /// Used by tests and UI-test reset paths.
    public static func resetPersistedPrefs() {
        UserDefaults.standard.removeObject(forKey: keepScreenAwakeKey)
    }
}
