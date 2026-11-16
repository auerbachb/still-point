import Foundation
import Observation

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

/// One optional component, addressed by the UserDefaults key it persists under.
public enum SessionScreenField: CaseIterable, Sendable {
    case blockGrid
    case progressBar
    case mindStateBar
    case statusLabel

    public var key: String {
        switch self {
        case .blockGrid: return "sp_sessionScreen_showBlockGrid"
        case .progressBar: return "sp_sessionScreen_showProgressBar"
        case .mindStateBar: return "sp_sessionScreen_showMindStateBar"
        case .statusLabel: return "sp_sessionScreen_showStatusLabel"
        }
    }

    public func value(in prefs: SessionScreenPrefs) -> Bool {
        switch self {
        case .blockGrid: return prefs.showBlockGrid
        case .progressBar: return prefs.showProgressBar
        case .mindStateBar: return prefs.showMindStateBar
        case .statusLabel: return prefs.showStatusLabel
        }
    }
}

/// Reads and writes the persisted `SessionScreenPrefs` in `UserDefaults`, one
/// boolean key per component. The `defaults` parameter lets tests use an isolated
/// suite instead of `UserDefaults.standard`.
public enum SessionScreenPrefsStore {
    public static func load(defaults: UserDefaults = .standard) -> SessionScreenPrefs {
        SessionScreenPrefs(
            showBlockGrid: bool(defaults, SessionScreenField.blockGrid),
            showProgressBar: bool(defaults, SessionScreenField.progressBar),
            showMindStateBar: bool(defaults, SessionScreenField.mindStateBar),
            showStatusLabel: bool(defaults, SessionScreenField.statusLabel)
        )
    }

    /// Writes exactly one key. A whole-struct write from a stale copy is what
    /// let one window undo another window's toggle (#75 review), so nothing
    /// writes more than the field that changed.
    public static func write(_ value: Bool, for field: SessionScreenField, defaults: UserDefaults = .standard) {
        defaults.set(value, forKey: field.key)
    }

    /// Wipes the persisted toggles back to the defaults. Used by tests and UI-test reset paths.
    public static func resetPersistedPrefs(defaults: UserDefaults = .standard) {
        SessionScreenField.allCases.forEach { defaults.removeObject(forKey: $0.key) }
    }

    /// An absent key means the user never changed it, so it reads as shown.
    private static func bool(_ defaults: UserDefaults, _ field: SessionScreenField) -> Bool {
        // `bool(forKey:)` rather than `as? Bool`: a launch-argument domain value such as
        // `-key NO` arrives as the string "NO", which only `bool(forKey:)` reads as false.
        guard defaults.object(forKey: field.key) != nil else { return true }
        return defaults.bool(forKey: field.key)
    }
}

/// The one shared, observable face of the session-screen toggles, as
/// `WakeLockPreferenceStore` and `ThemeModePreferenceStore` are (#742): every
/// scene reads and writes the same object, so SwiftUI redraws them together.
@Observable
@MainActor
public final class SessionScreenPreferenceStore {
    public static let shared = SessionScreenPreferenceStore()

    /// Moves once per recorded change; reading `prefs` puts the caller on the observation graph.
    private var revision = 0

    init() {}

    public var prefs: SessionScreenPrefs {
        _ = revision
        return SessionScreenPrefsStore.load()
    }

    /// Records one component's choice and writes nothing when it already matches.
    public func setValue(_ value: Bool, for field: SessionScreenField) {
        guard value != field.value(in: prefs) else { return }
        SessionScreenPrefsStore.write(value, for: field)
        revision &+= 1
    }
}
