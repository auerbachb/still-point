import Foundation

#if targetEnvironment(simulator)

@Observable
@MainActor
final class AppBlockingManager {
    var unlockedForDate: Date?
    var lastErrorMessage: String?
    var isApplyingShield = false
    private(set) var didUnlockFromLastCompletedSession = false

    private let defaults: UserDefaults
    private let unlockedForDateKey = "appBlocking.unlockedForDate.v1"
    private let uiTestSelectionEnabled: Bool
    private var midnightTimer: Timer?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.unlockedForDate = defaults.object(forKey: unlockedForDateKey) as? Date
        self.uiTestSelectionEnabled = ProcessInfo.processInfo.environment["SP_UI_TEST_APP_BLOCKING_SELECTED"] == "1"
        refreshShielding()
    }

    var isAuthorizationApproved: Bool { uiTestSelectionEnabled }
    var hasSelection: Bool { uiTestSelectionEnabled }
    var selectedItemCount: Int { uiTestSelectionEnabled ? 1 : 0 }

    /// Unlocked when a qualifying session was completed earlier *today* (local calendar day).
    var isUnlocked: Bool {
        guard let unlockedForDate else { return false }
        return Calendar.current.isDateInToday(unlockedForDate)
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
        defaults.set(unlockedForDate, forKey: unlockedForDateKey)
        scheduleMidnightResetTimer()
    }

    func lockNow() {
        didUnlockFromLastCompletedSession = false
        unlockedForDate = nil
        defaults.removeObject(forKey: unlockedForDateKey)
        scheduleMidnightResetTimer()
    }

    func refreshShielding() {
        // Daily reset: an unlock only counts for the calendar day it was earned.
        // When the app foregrounds (or the midnight timer fires) on a new day, the
        // stale date is cleared and the apps re-lock.
        if let unlockedForDate, !Calendar.current.isDateInToday(unlockedForDate) {
            self.unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            defaults.removeObject(forKey: unlockedForDateKey)
        }

        if !hasSelection {
            unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            defaults.removeObject(forKey: unlockedForDateKey)
        }
        scheduleMidnightResetTimer()
    }

    /// Schedule a one-shot timer for the next local midnight so apps re-lock even
    /// if the app stays foregrounded across the day boundary. Only needed while unlocked.
    private func scheduleMidnightResetTimer() {
        midnightTimer?.invalidate()
        midnightTimer = nil
        guard isUnlocked, let nextMidnight = Self.nextLocalMidnight() else { return }
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
}

#else

import FamilyControls
import ManagedSettings

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
    private let selectionKey = "appBlocking.selection.v1"
    private let unlockedForDateKey = "appBlocking.unlockedForDate.v1"
    private let uiTestMode: Bool
    private let uiTestSelectionEnabled: Bool
    private var midnightTimer: Timer?

    init(defaults: UserDefaults = .standard) {
        let environment = ProcessInfo.processInfo.environment
        let uiTestMode = environment["SP_UI_TEST_MODE"] == "1"
        let uiTestSelectionEnabled = environment["SP_UI_TEST_APP_BLOCKING_SELECTED"] == "1"
        self.defaults = defaults
        self.selection = Self.loadSelection(defaults: defaults, key: selectionKey)
        self.unlockedForDate = defaults.object(forKey: unlockedForDateKey) as? Date
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
        guard let unlockedForDate else { return false }
        return Calendar.current.isDateInToday(unlockedForDate)
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
        defaults.set(unlockedForDate, forKey: unlockedForDateKey)
        lastErrorMessage = nil
        clearShielding()
        scheduleMidnightResetTimer()
    }

    func lockNow() {
        didUnlockFromLastCompletedSession = false
        unlockedForDate = nil
        defaults.removeObject(forKey: unlockedForDateKey)
        refreshShielding()
    }

    func refreshShielding() {
        if !uiTestMode {
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
        }

        // Daily reset: an unlock only counts for the calendar day it was earned.
        // When the app foregrounds (or the midnight timer fires) on a new day, the
        // stale date is cleared and the apps re-lock.
        if let unlockedForDate, !Calendar.current.isDateInToday(unlockedForDate) {
            self.unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            defaults.removeObject(forKey: unlockedForDateKey)
        }

        if !hasSelection {
            unlockedForDate = nil
            didUnlockFromLastCompletedSession = false
            defaults.removeObject(forKey: unlockedForDateKey)
            scheduleMidnightResetTimer()
            clearShielding()
            return
        }

        guard !isUnlocked else {
            scheduleMidnightResetTimer()
            clearShielding()
            return
        }

        guard isAuthorizationApproved else {
            clearShielding()
            return
        }

        applyShielding()
        scheduleMidnightResetTimer()
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

    /// Schedule a one-shot timer for the next local midnight so apps re-lock even
    /// if the app stays foregrounded across the day boundary. Only needed while unlocked.
    private func scheduleMidnightResetTimer() {
        midnightTimer?.invalidate()
        midnightTimer = nil
        guard isUnlocked, let nextMidnight = Self.nextLocalMidnight() else { return }
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
        do {
            let encoded = try JSONEncoder().encode(selection)
            defaults.set(encoded, forKey: selectionKey)
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = "Could not save selected apps."
        }
    }

    private static func loadSelection(defaults: UserDefaults, key: String) -> FamilyActivitySelection {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else {
            return FamilyActivitySelection()
        }
        return decoded
    }
}

#endif
