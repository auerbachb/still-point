import Foundation

/// #665 — the last authenticated `UserDTO`, kept on the device so a launch with no
/// network still knows who you are, what day you're on, and which tracks you run.
///
/// **Where it lives.** The App Group container the widget already reads
/// (`WidgetAppGroup.id`), not a private app container. The widget's snapshot is
/// this codebase's existing precedent for "trust local state, reconcile later"
/// (#671/#676), and putting identity beside it keeps one local source of truth
/// instead of two that can drift. The session *token* stays in the Keychain
/// (`AuthTokenStore`) where it belongs — only the non-secret identity payload
/// (id, username, day counters, feature flags) is stored here.
///
/// **Staleness is accepted, deliberately.** A cached identity older than the
/// server's session means the user sits happily offline and then hits a 401 on
/// reconnect, at which point `clearIfAuthoritative(on:)` wipes it and they sign in
/// again. That is strictly better than the alternative it replaces — being logged
/// out at the moment of *losing* the network rather than the moment of regaining it.
public enum CachedIdentityStore {
    /// App Group key. Versioned like `WidgetAppGroup.dataKey` so a future shape
    /// change can be introduced without misreading an old payload.
    public static let key = "identity.cachedUser.v1"

    public static func load(from defaults: UserDefaults? = WidgetDataStore.sharedDefaults) -> UserDTO? {
        guard let defaults, let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(UserDTO.self, from: data)
    }

    /// Persist the authenticated user. Call on every successful `me()` so the
    /// local copy tracks the server (day number, recovery ramp, track opt-ins).
    @discardableResult
    public static func save(
        _ user: UserDTO,
        into defaults: UserDefaults? = WidgetDataStore.sharedDefaults
    ) -> Bool {
        guard let defaults, let data = try? JSONEncoder().encode(user) else { return false }
        defaults.set(data, forKey: key)
        return true
    }

    public static func clear(from defaults: UserDefaults? = WidgetDataStore.sharedDefaults) {
        defaults?.removeObject(forKey: key)
    }

    /// Clear the cached identity only for a cause authoritative enough to prove the
    /// session is over — the same predicate that guards the widget's stored week
    /// (#676). A dropped connection or a 5xx is never one of them.
    ///
    /// Returns whether it actually cleared, so callers can gate the rest of their
    /// sign-out teardown (`trackingControlPrefsManager.clearOnLogout()`, the
    /// per-account unlock reset) on the same single answer.
    @discardableResult
    public static func clearIfAuthoritative(
        on cause: WidgetDataStore.SignedOutCause,
        from defaults: UserDefaults? = WidgetDataStore.sharedDefaults
    ) -> Bool {
        guard WidgetDataStore.shouldClearStoredSnapshot(on: cause) else { return false }
        clear(from: defaults)
        return true
    }
}
