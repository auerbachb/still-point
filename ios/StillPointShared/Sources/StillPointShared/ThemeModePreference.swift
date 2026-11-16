import Foundation
import Observation

/// #30: the app's appearance choice. `system` is the default and follows the
/// device; `light` and `dark` force that scheme for every window.
///
/// Persisted by raw value under `ThemePrefs.key`. The raw values are part of the
/// stored contract, so do not rename them.
public enum ThemeMode: String, CaseIterable, Sendable {
    case system
    case light
    case dark

    /// The scheme to force, or `nil` to let the OS decide. Mapped to SwiftUI's
    /// `ColorScheme` in the app target, which is the only place SwiftUI is used.
    public var forcedScheme: ThemeScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// The two schemes a `ThemeMode` can force. Kept separate from SwiftUI's
/// `ColorScheme` so this package stays free of SwiftUI.
public enum ThemeScheme: Sendable, Equatable {
    case light
    case dark
}

/// Persists the appearance choice in `UserDefaults.standard`, following the
/// `WakeLockPrefs` convention: a static enum with an explicit reset for tests and
/// UI-test reset paths.
public enum ThemePrefs {
    /// iOS UserDefaults key.
    public static let key = "sp_themeMode"

    /// Resolves a stored raw value. Absent or unrecognised values take `.system`,
    /// so a new install and a corrupted value both follow the device.
    public static func resolve(rawValue: String?) -> ThemeMode {
        rawValue.flatMap(ThemeMode.init(rawValue:)) ?? .system
    }

    /// The current choice. Reading never writes.
    public static var mode: ThemeMode {
        resolve(rawValue: UserDefaults.standard.string(forKey: key))
    }

    /// Records an explicit choice.
    public static func setMode(_ mode: ThemeMode) {
        UserDefaults.standard.set(mode.rawValue, forKey: key)
    }

    /// Wipes the persisted choice, returning the install to `.system`.
    public static func resetPersistedPrefs() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

/// The process-wide, observable face of the appearance choice, shared by every
/// scene the same way `WakeLockPreferenceStore` is (#742): one object, so changing
/// the mode in one iPad window re-renders every window together.
///
/// `mode` reads storage on every access. `revision` exists only to carry SwiftUI
/// invalidation, because `UserDefaults` is not something `@Observable` can track.
@Observable
@MainActor
public final class ThemeModePreferenceStore {
    /// The one instance every scene reads.
    public static let shared = ThemeModePreferenceStore()

    private var revision = 0

    init() {}

    public var mode: ThemeMode {
        // Read for its observation side effect alone.
        _ = revision
        return ThemePrefs.mode
    }

    /// Records a choice, writing nothing when it matches what is already stored.
    public func setMode(_ mode: ThemeMode) {
        guard mode != ThemePrefs.mode else { return }
        ThemePrefs.setMode(mode)
        revision &+= 1
    }
}
