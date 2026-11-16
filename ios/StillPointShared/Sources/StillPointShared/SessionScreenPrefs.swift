import Foundation

/// Which optional components the session screen shows (#75).
///
/// The countdown and the pause/end controls are never hideable, so they are not
/// represented here. Each flag defaults to `true`, so an untouched install shows the
/// full session screen as it does today.
///
/// Mirrors the web `DisplayPrefs` fields in `src/lib/displayPrefs.ts`. The web app
/// has no separate status label, so `showStatusLabel` exists only on iOS.
public struct SessionScreenPrefs: Equatable, Sendable {
    public var showBlockGrid: Bool
    public var showProgressBar: Bool
    public var showMindStateBar: Bool
    public var showStatusLabel: Bool

    public init(
        showBlockGrid: Bool = true,
        showProgressBar: Bool = true,
        showMindStateBar: Bool = true,
        showStatusLabel: Bool = true
    ) {
        self.showBlockGrid = showBlockGrid
        self.showProgressBar = showProgressBar
        self.showMindStateBar = showMindStateBar
        self.showStatusLabel = showStatusLabel
    }

    /// What actually renders. Minimal view (#669) is "just the timer", so it hides
    /// every optional component whatever the saved toggles say. The saved values are
    /// left untouched, so turning minimal view off restores the user's layout.
    public func resolved(minimal: Bool) -> SessionScreenPrefs {
        guard !minimal else {
            return SessionScreenPrefs(
                showBlockGrid: false,
                showProgressBar: false,
                showMindStateBar: false,
                showStatusLabel: false
            )
        }
        return self
    }
}

/// Persists `SessionScreenPrefs` in `UserDefaults`, one boolean key per component.
///
/// Follows the `MinimalSessionViewPrefs` convention: a static enum over defaults.
/// The `defaults` parameter lets tests use an isolated suite instead of
/// `UserDefaults.standard`.
public enum SessionScreenPrefsStore {
    public static let showBlockGridKey = "sp_sessionScreen_showBlockGrid"
    public static let showProgressBarKey = "sp_sessionScreen_showProgressBar"
    public static let showMindStateBarKey = "sp_sessionScreen_showMindStateBar"
    public static let showStatusLabelKey = "sp_sessionScreen_showStatusLabel"

    public static func load(defaults: UserDefaults = .standard) -> SessionScreenPrefs {
        SessionScreenPrefs(
            showBlockGrid: bool(defaults, showBlockGridKey),
            showProgressBar: bool(defaults, showProgressBarKey),
            showMindStateBar: bool(defaults, showMindStateBarKey),
            showStatusLabel: bool(defaults, showStatusLabelKey)
        )
    }

    public static func save(_ prefs: SessionScreenPrefs, defaults: UserDefaults = .standard) {
        defaults.set(prefs.showBlockGrid, forKey: showBlockGridKey)
        defaults.set(prefs.showProgressBar, forKey: showProgressBarKey)
        defaults.set(prefs.showMindStateBar, forKey: showMindStateBarKey)
        defaults.set(prefs.showStatusLabel, forKey: showStatusLabelKey)
    }

    /// Wipes the persisted toggles back to the defaults. Used by tests and UI-test reset paths.
    public static func resetPersistedPrefs(defaults: UserDefaults = .standard) {
        [showBlockGridKey, showProgressBarKey, showMindStateBarKey, showStatusLabelKey]
            .forEach { defaults.removeObject(forKey: $0) }
    }

    /// An absent key means the user never changed it, so it reads as shown.
    private static func bool(_ defaults: UserDefaults, _ key: String) -> Bool {
        defaults.object(forKey: key) as? Bool ?? true
    }
}
