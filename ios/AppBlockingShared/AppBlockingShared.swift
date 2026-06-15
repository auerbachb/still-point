import Foundation

/// Storage + scheduling shared between the main app and the `StillPointMonitor`
/// DeviceActivity extension (#423).
///
/// The extension runs in its own sandboxed process, so the saved
/// `FamilyActivitySelection` is shared through an App Group's `UserDefaults`.
/// The Family Controls / DeviceActivity APIs are guarded behind
/// `#if !targetEnvironment(simulator)` to match the rest of the app: the
/// simulator (PR e2e) build never links those frameworks, so it launches
/// without the device-only entitlements.
enum AppBlockingShared {
    /// App Group shared by the app + monitor extension. Must be enabled on both
    /// App IDs and present in both provisioning profiles (device only).
    static let appGroupID = "group.com.brettonauerbach.stillpoint"

    /// Key for the encoded `FamilyActivitySelection` in the shared suite.
    /// Matches the historical app-only key so a migration can copy it forward.
    static let selectionKey = "appBlocking.selection.v1"

    /// Identifier for the repeating daily monitoring interval.
    static let activityName = "dailyLock"

    /// Shared defaults suite the app writes the selection to and the extension reads.
    static var sharedDefaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }
}

#if !targetEnvironment(simulator)
import FamilyControls
import ManagedSettings
import DeviceActivity

extension AppBlockingShared {
    static var deviceActivityName: DeviceActivityName { DeviceActivityName(activityName) }

    /// Repeating daily schedule whose interval starts at local midnight. The
    /// monitor extension's `intervalDidStart` fires at the start of each day,
    /// which is when the gated apps re-lock — even if the app is suspended.
    static func dailySchedule() -> DeviceActivitySchedule {
        DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59, second: 59),
            repeats: true
        )
    }

    /// Decode the stored selection, distinguishing a load *failure* from a genuine
    /// "no selection": returns `nil` when the App Group is unavailable or stored
    /// data exists but cannot be decoded (corruption); returns an empty selection
    /// only when no data has ever been saved. Callers that mutate shields must
    /// treat `nil` as "do not relax shielding" (fail closed).
    static func decodeStoredSelection() -> FamilyActivitySelection? {
        guard let defaults = sharedDefaults else { return nil }
        guard let data = defaults.data(forKey: selectionKey) else {
            return FamilyActivitySelection()
        }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    /// Convenience for the app's in-memory selection at launch: an empty selection
    /// on any failure. The unattended monitor path uses `decodeStoredSelection()`
    /// instead, so a read/decode failure there never clears existing shields.
    static func loadSelection() -> FamilyActivitySelection {
        decodeStoredSelection() ?? FamilyActivitySelection()
    }

    /// Persist the selection to the shared suite so the extension can read it.
    @discardableResult
    static func saveSelection(_ selection: FamilyActivitySelection) -> Bool {
        guard let data = try? JSONEncoder().encode(selection) else { return false }
        guard let defaults = sharedDefaults else { return false }
        defaults.set(data, forKey: selectionKey)
        return true
    }

    /// Re-apply the shield for the saved selection. Called by the extension at
    /// interval start (new local day → re-lock). Deliberately minimal to respect
    /// the DeviceActivity extension's tight memory budget.
    ///
    /// Fail closed: the monitor only ever *adds* shields for a confidently decoded,
    /// non-empty selection. If the App Group is unavailable, the stored data is
    /// missing/corrupt, or the selection is empty, it leaves the current shield
    /// state untouched rather than clearing it — a transient read/decode failure
    /// must never silently unlock the user's apps at midnight. Clearing shields is
    /// exclusively the app's job (on a qualifying unlock), never the monitor's.
    static func applySavedShield(to store: ManagedSettingsStore) {
        guard let selection = decodeStoredSelection() else { return }
        let isEmpty = selection.applicationTokens.isEmpty
            && selection.categoryTokens.isEmpty
            && selection.webDomainTokens.isEmpty
        guard !isEmpty else { return }
        store.shield.applications = selection.applicationTokens.isEmpty
            ? nil
            : selection.applicationTokens
        store.shield.applicationCategories = selection.categoryTokens.isEmpty
            ? nil
            : .specific(selection.categoryTokens)
        store.shield.webDomains = selection.webDomainTokens.isEmpty
            ? nil
            : selection.webDomainTokens
    }
}
#endif
