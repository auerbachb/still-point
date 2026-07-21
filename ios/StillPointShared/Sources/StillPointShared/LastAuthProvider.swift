import Foundation

/// Tracks which sign-in method the user last used successfully (#528 / web #337).
///
/// Persists to `UserDefaults` with the same key as web `localStorage` so values
/// could theoretically be shared if the platforms ever share storage (they do not
/// today, but the key keeps naming parity).
public enum LastAuthProvider {
    public static let storageKey = "stillpoint_last_auth_provider"

    public enum Method: String, CaseIterable, Sendable {
        case google
        case apple
        case email
    }

    public static func load() -> Method? {
        guard let raw = UserDefaults.standard.string(forKey: storageKey) else { return nil }
        return Method(rawValue: raw)
    }

    public static func save(_ method: Method) {
        UserDefaults.standard.set(method.rawValue, forKey: storageKey)
    }

    /// Wipes persisted value. Used by unit tests and UI-test reset paths.
    public static func resetPersisted() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}
