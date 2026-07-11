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

    /// Key for the calendar day the user last earned an unlock. Stored in the App
    /// Group so the monitor extension and background refresh can decide whether
    /// shields should be applied without launching the main app (#549).
    static let unlockedForDateKey = "appBlocking.unlockedForDate.v1"

    /// Identifier for the repeating daily monitoring interval.
    static let activityName = "dailyLock"

    /// Hourly heartbeat so a missed midnight callback still re-locks within ~1h.
    static let heartbeatActivityName = "shieldHeartbeat"

    /// Shared defaults suite the app writes the selection to and the extension reads.
    static var sharedDefaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }

    /// Read the unlock date from the App Group, falling back to standard defaults
    /// for older installs that have not migrated yet.
    static func loadUnlockedForDate(from standardDefaults: UserDefaults? = nil) -> Date? {
        if let shared = sharedDefaults?.object(forKey: unlockedForDateKey) as? Date {
            return shared
        }
        return standardDefaults?.object(forKey: unlockedForDateKey) as? Date
    }

    /// Persist the unlock date to the App Group (for the extension) and standard
    /// defaults (for in-app reads on older code paths).
    static func saveUnlockedForDate(_ date: Date?, standardDefaults: UserDefaults? = nil) {
        if let date {
            sharedDefaults?.set(date, forKey: unlockedForDateKey)
            standardDefaults?.set(date, forKey: unlockedForDateKey)
        } else {
            sharedDefaults?.removeObject(forKey: unlockedForDateKey)
            standardDefaults?.removeObject(forKey: unlockedForDateKey)
        }
    }

    /// One-time migration of the unlock date from standard `UserDefaults` into the
    /// App Group suite so the monitor extension can read it.
    static func migrateLegacyUnlockDateIfNeeded(from standardDefaults: UserDefaults) {
        guard sharedDefaults?.object(forKey: unlockedForDateKey) == nil,
              let legacy = standardDefaults.object(forKey: unlockedForDateKey) as? Date else { return }
        sharedDefaults?.set(legacy, forKey: unlockedForDateKey)
    }
}

#if !targetEnvironment(simulator)
import FamilyControls
import ManagedSettings
import DeviceActivity

extension AppBlockingShared {
    static var deviceActivityName: DeviceActivityName { DeviceActivityName(activityName) }
    static var heartbeatDeviceActivityName: DeviceActivityName { DeviceActivityName(heartbeatActivityName) }

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

    /// Hourly 15-minute window (DeviceActivity minimum). Gives the monitor
    /// extension additional chances to re-apply shields when the midnight
    /// callback is delayed or dropped (#549).
    static func hourlyHeartbeatSchedule() -> DeviceActivitySchedule {
        DeviceActivitySchedule(
            intervalStart: DateComponents(minute: 0),
            intervalEnd: DateComponents(minute: 14),
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

    /// Reconcile ManagedSettings shields with the shared unlock + selection state.
    /// Used by the monitor extension and background refresh so gated apps re-lock
    /// even when Still Point has not been opened (#549).
    static func syncShieldState(
        to store: ManagedSettingsStore,
        now: Date = Date(),
        calendar: Calendar = .current
    ) {
        if !shouldApplyShield(now: now, calendar: calendar) {
            store.clearAllSettings()
            return
        }
        applySavedShield(to: store)
    }

    /// `true` when shields should be active: no unlock stored, or the stored
    /// unlock is from a prior local calendar day. Mirrors `AppBlockGate` (#348).
    static func shouldApplyShield(now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard let unlockedFor = loadUnlockedForDate() else { return true }
        return !calendar.isDate(unlockedFor, inSameDayAs: now)
    }

    /// Background refresh entry point — constructs a store and syncs shields.
    static func syncShieldStateFromSharedDefaults() {
        syncShieldState(to: ManagedSettingsStore())
    }
}
#endif
