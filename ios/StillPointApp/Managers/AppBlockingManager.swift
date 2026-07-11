import Foundation
import StillPointShared

#if targetEnvironment(simulator)

@Observable
@MainActor
final class AppBlockingManager {
    var unlockedForDate: Date?
    var lastErrorMessage: String?
    var isApplyingShield = false
    private(set) var didUnlockFromLastCompletedSession = false

    private let defaults: UserDefaults
    private let uiTestSelectionEnabled: Bool

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        AppBlockingShared.migrateLegacyUnlockDateIfNeeded(from: defaults)
        self.unlockedForDate = AppBlockingShared.loadUnlockedForDate(from: defaults)
        self.uiTestSelectionEnabled = ProcessInfo.processInfo.environment["SP_UI_TEST_APP_BLOCKING_SELECTED"] == "1"
        refreshShielding()
    }

    var isAuthorizationApproved: Bool { uiTestSelectionEnabled }
    var hasSelection: Bool { uiTestSelectionEnabled }
    var selectedItemCount: Int { uiTestSelectionEnabled ? 1 : 0 }

    /// Unlocked when a qualifying session was completed earlier *today* (local calendar day).
    var isUnlocked: Bool {
        !AppBlockGate.isUnlockExpired(unlockedFor: unlockedForDate)
    }

    var statusText: String {
        guard hasSelection else {
            return "Choose the apps you want Still Point to hold during practice."
        }
        if isUnlocked {
            return "Unlocked for the rest of today."
        }
        return "Blocked until you complete today's sit."
    }

    func requestAuthorizationIfNeeded() async {}
    func persistSelectionAndRefreshShielding() {}

    /// Called when a session ends *without* a qualifying completion (e.g. ended early).
    /// In the daily-lock model this neither grants nor revokes today's unlock — if a
    /// qualifying session was already completed today the apps stay unlocked until
    /// midnight; otherwise they remain blocked.
    func prepareForSession() {
        didUnlockFromLastCompletedSession = false
        refreshShielding()
    }

    func unlockAfterCompletedSession() {
        didUnlockFromLastCompletedSession = false
        guard hasSelection else { return }
        unlockedForDate = Date()
        didUnlockFromLastCompletedSession = true
        AppBlockingShared.saveUnlockedForDate(unlockedForDate, standardDefaults: defaults)
    }

    func lockNow() {
        didUnlockFromLastCompletedSession = false
        unlockedForDate = nil
        AppBlockingShared.saveUnlockedForDate(nil, standardDefaults: defaults)
    }

    func refreshShielding() {
        // Daily reset: an unlock only counts for the calendar day it was earned.
        // When the app foregrounds on a new day, the stale date is cleared.
        if unlockedForDate != nil, AppBlockGate.isUnlockExpired(unlockedFor: unlockedForDate) {
            unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            AppBlockingShared.saveUnlockedForDate(nil, standardDefaults: defaults)
        }

        if !hasSelection {
            unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            AppBlockingShared.saveUnlockedForDate(nil, standardDefaults: defaults)
        }
    }
}

#else

import FamilyControls
import ManagedSettings
import DeviceActivity

@Observable
@MainActor
final class AppBlockingManager {
    var selection: FamilyActivitySelection
    var authorizationStatus: AuthorizationStatus
    var unlockedForDate: Date?
    var lastErrorMessage: String?
    var isApplyingShield = false
    private(set) var didUnlockFromLastCompletedSession = false

    private let defaults: UserDefaults
    private let store: ManagedSettingsStore?
    private let uiTestMode: Bool
    private let uiTestSelectionEnabled: Bool
    private let deviceActivityCenter = DeviceActivityCenter()
    /// Foreground-only backup: fires at the next local midnight while the app is
    /// open so the in-app state re-locks even if the system schedule is delayed.
    /// DeviceActivity remains the primary mechanism (it runs while suspended).
    private var midnightTimer: Timer?

    init(defaults: UserDefaults = .standard) {
        let environment = ProcessInfo.processInfo.environment
        let uiTestMode = environment["SP_UI_TEST_MODE"] == "1"
        let uiTestSelectionEnabled = environment["SP_UI_TEST_APP_BLOCKING_SELECTED"] == "1"
        self.defaults = defaults
        if !uiTestMode {
            // Older builds stored the selection in standard defaults; copy it into
            // the App Group suite so the monitor extension can read it.
            Self.migrateLegacySelectionIfNeeded(from: defaults)
            AppBlockingShared.migrateLegacyUnlockDateIfNeeded(from: defaults)
        }
        self.selection = AppBlockingShared.loadSelection()
        self.unlockedForDate = AppBlockingShared.loadUnlockedForDate(from: defaults)
        self.authorizationStatus = uiTestMode ? .notDetermined : AuthorizationCenter.shared.authorizationStatus
        self.uiTestMode = uiTestMode
        self.uiTestSelectionEnabled = uiTestSelectionEnabled
        self.store = uiTestMode ? nil : ManagedSettingsStore()
        if !uiTestMode {
            refreshShielding()
        }
    }

    var isAuthorizationApproved: Bool {
        uiTestSelectionEnabled || authorizationStatus == .approved
    }

    var hasSelection: Bool {
        selectedItemCount > 0
    }

    var selectedItemCount: Int {
        if uiTestSelectionEnabled {
            return max(1, realSelectedItemCount)
        }
        return realSelectedItemCount
    }

    /// Unlocked when a qualifying session was completed earlier *today* (local calendar day).
    var isUnlocked: Bool {
        !AppBlockGate.isUnlockExpired(unlockedFor: unlockedForDate)
    }

    var statusText: String {
        guard hasSelection else {
            return "Choose the apps you want Still Point to hold during practice."
        }
        if isUnlocked {
            return "Unlocked for the rest of today."
        }
        return "Blocked until you complete today's sit."
    }

    func requestAuthorizationIfNeeded() async {
        guard !uiTestSelectionEnabled, authorizationStatus != .approved else { return }
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
            lastErrorMessage = nil
            refreshShielding()
        } catch {
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
            lastErrorMessage = "Screen Time permission is needed to block selected apps."
        }
    }

    func persistSelectionAndRefreshShielding() {
        saveSelection()
        // Note: if the user has already unlocked for today, refreshShielding() leaves
        // newly added apps unshielded — they "earned" today already and only start
        // blocking tomorrow. Adding apps while still blocked shields them immediately.
        refreshShielding()
    }

    /// Called when a session ends *without* a qualifying completion (e.g. ended early).
    /// In the daily-lock model this neither grants nor revokes today's unlock — if a
    /// qualifying session was already completed today the apps stay unlocked until
    /// midnight; otherwise they remain blocked.
    func prepareForSession() {
        didUnlockFromLastCompletedSession = false
        refreshShielding()
    }

    func unlockAfterCompletedSession() {
        didUnlockFromLastCompletedSession = false
        guard hasSelection else { return }
        unlockedForDate = Date()
        didUnlockFromLastCompletedSession = true
        AppBlockingShared.saveUnlockedForDate(unlockedForDate, standardDefaults: defaults)
        lastErrorMessage = nil
        clearShielding()
        // Keep the daily schedule (and foreground backup) armed so the apps re-lock
        // at the next local midnight even if the app is suspended/terminated overnight.
        updateDailyResetScheduling()
    }

    func lockNow() {
        didUnlockFromLastCompletedSession = false
        unlockedForDate = nil
        AppBlockingShared.saveUnlockedForDate(nil, standardDefaults: defaults)
        refreshShielding()
    }

    func refreshShielding() {
        if !uiTestMode {
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
        }

        // Daily reset: an unlock only counts for the calendar day it was earned.
        // When the app foregrounds on a new day, the stale date is cleared and the
        // apps re-lock. (The DeviceActivity monitor handles re-locking while the app
        // is suspended; this foreground pass is the belt-and-suspenders backup.)
        if unlockedForDate != nil, AppBlockGate.isUnlockExpired(unlockedFor: unlockedForDate) {
            unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            AppBlockingShared.saveUnlockedForDate(nil, standardDefaults: defaults)
        }

        if !hasSelection {
            unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            AppBlockingShared.saveUnlockedForDate(nil, standardDefaults: defaults)
            updateDailyResetScheduling()
            clearShielding()
            return
        }

        guard !isUnlocked else {
            updateDailyResetScheduling()
            clearShielding()
            return
        }

        guard isAuthorizationApproved else {
            // Authorization was lost/never granted: tear down the schedule + backup
            // timer so a stale DeviceActivity registration can't re-shield later.
            updateDailyResetScheduling()
            clearShielding()
            return
        }

        applyShielding()
        updateDailyResetScheduling()
    }

    private var realSelectedItemCount: Int {
        selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
    }

    private func applyShielding() {
        guard !uiTestMode else {
            isApplyingShield = false
            return
        }
        isApplyingShield = true
        defer { isApplyingShield = false }
        guard let store else {
            isApplyingShield = false
            return
        }
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

    private func clearShielding() {
        guard !uiTestMode else { return }
        store?.clearAllSettings()
    }

    /// Arm or tear down the daily re-lock machinery based on whether there is an
    /// authorized selection to guard.
    ///
    /// - Primary: a repeating `DeviceActivitySchedule`. The monitor extension's
    ///   `intervalDidStart` re-applies the shield at local midnight even when the
    ///   app is suspended/terminated — the case the old in-process `Timer` could
    ///   not handle.
    /// - Heartbeat: an hourly 15-minute window gives the extension extra chances
    ///   to reconcile shields when the midnight callback is dropped (#549).
    /// - Backup: a foreground-only one-shot `Timer` to the next local midnight, so
    ///   if the app stays open across the day boundary (no `scenePhase` change to
    ///   trigger `refreshShielding`) the in-app state still re-locks promptly even
    ///   if the system schedule is delayed.
    /// - Background refresh: `BGAppRefreshTask` as a tertiary fallback when the
    ///   extension does not run (#549).
    ///
    /// When there is no authorized selection both are torn down, so a stale schedule
    /// can never re-shield after the user removes apps or revokes authorization.
    private func updateDailyResetScheduling() {
        guard !uiTestMode else { return }
        guard hasSelection, isAuthorizationApproved else {
            deviceActivityCenter.stopMonitoring([
                AppBlockingShared.deviceActivityName,
                AppBlockingShared.heartbeatDeviceActivityName,
            ])
            midnightTimer?.invalidate()
            midnightTimer = nil
            return
        }
        do {
            try deviceActivityCenter.startMonitoring(
                AppBlockingShared.deviceActivityName,
                during: AppBlockingShared.dailySchedule()
            )
            try deviceActivityCenter.startMonitoring(
                AppBlockingShared.heartbeatDeviceActivityName,
                during: AppBlockingShared.hourlyHeartbeatSchedule()
            )
        } catch {
            // Re-registering an already-active schedule is benign. Any other
            // failure just means the system schedule isn't armed this run; the
            // foreground backup timer + foreground refresh remain, so the
            // daily-lock guarantee degrades gracefully rather than breaking.
        }
        scheduleForegroundMidnightBackup()
        AppBlockingBackgroundScheduler.scheduleRefresh(
            preferring: Self.nextShieldCheckDate(unlockedFor: unlockedForDate)
        )
    }

    /// Prefer the next local midnight when the user is unlocked; otherwise ask for
    /// a sooner opportunistic refresh so a missed extension callback is corrected.
    private static func nextShieldCheckDate(unlockedFor: Date?) -> Date {
        if let unlockedFor,
           !AppBlockGate.isUnlockExpired(unlockedFor: unlockedFor),
           let nextMidnight = nextLocalMidnight() {
            return nextMidnight
        }
        return Date(timeIntervalSinceNow: 15 * 60)
    }

    private func scheduleForegroundMidnightBackup() {
        midnightTimer?.invalidate()
        midnightTimer = nil
        guard let nextMidnight = Self.nextLocalMidnight() else { return }
        let interval = nextMidnight.timeIntervalSinceNow
        guard interval > 0 else { return }
        midnightTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.refreshShielding()
            }
        }
    }

    private static func nextLocalMidnight() -> Date? {
        Calendar.current.nextDate(
            after: Date(),
            matching: DateComponents(hour: 0, minute: 0, second: 0),
            matchingPolicy: .nextTime
        )
    }

    private func saveSelection() {
        guard !uiTestMode else { return }
        if AppBlockingShared.saveSelection(selection) {
            lastErrorMessage = nil
        } else {
            lastErrorMessage = "Could not save selected apps."
        }
    }

    /// One-time migration of the encoded selection from standard `UserDefaults`
    /// (older builds) into the App Group suite. No-op once the shared suite holds
    /// a value, or if there is nothing to migrate.
    private static func migrateLegacySelectionIfNeeded(from defaults: UserDefaults) {
        guard let shared = AppBlockingShared.sharedDefaults else { return }
        let key = AppBlockingShared.selectionKey
        guard shared.data(forKey: key) == nil,
              let legacy = defaults.data(forKey: key) else { return }
        shared.set(legacy, forKey: key)
    }
}

#endif
