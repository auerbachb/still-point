import Foundation
import FamilyControls
import ManagedSettings

@Observable
@MainActor
final class AppBlockingManager {
    static let unlockWindow: TimeInterval = 2 * 60 * 60

    var selection: FamilyActivitySelection
    var authorizationStatus: AuthorizationStatus
    var unlockUntil: Date?
    var lastErrorMessage: String?
    var isApplyingShield = false
    private(set) var didUnlockFromLastCompletedSession = false

    private let defaults: UserDefaults
    private let store: ManagedSettingsStore?
    private let selectionKey = "appBlocking.selection.v1"
    private let unlockUntilKey = "appBlocking.unlockUntil.v1"
    private let uiTestMode: Bool
    private let uiTestSelectionEnabled: Bool

    init(defaults: UserDefaults = .standard) {
        let environment = ProcessInfo.processInfo.environment
        let uiTestMode = environment["SP_UI_TEST_MODE"] == "1"
        let uiTestSelectionEnabled = environment["SP_UI_TEST_APP_BLOCKING_SELECTED"] == "1"
        self.defaults = defaults
        self.selection = Self.loadSelection(defaults: defaults, key: selectionKey)
        self.unlockUntil = defaults.object(forKey: unlockUntilKey) as? Date
        self.authorizationStatus = uiTestMode ? .notDetermined : AuthorizationCenter.shared.authorizationStatus
        self.uiTestMode = uiTestMode
        self.uiTestSelectionEnabled = uiTestSelectionEnabled
        self.store = uiTestMode ? nil : ManagedSettingsStore()
        refreshShielding()
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

    var isUnlocked: Bool {
        guard let unlockUntil else { return false }
        return unlockUntil > Date()
    }

    var statusText: String {
        guard hasSelection else {
            return "Choose the apps you want Still Point to hold during practice."
        }
        if isUnlocked, let unlockUntil {
            return "Unlocked until \(Self.timeFormatter.string(from: unlockUntil))."
        }
        return "Selected apps stay blocked until you complete a session."
    }

    var unlockWindowText: String {
        "2 hours"
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
        refreshShielding()
    }

    func prepareForSession() {
        didUnlockFromLastCompletedSession = false
    }

    func unlockAfterCompletedSession() {
        didUnlockFromLastCompletedSession = false
        guard hasSelection else { return }
        unlockUntil = Date().addingTimeInterval(Self.unlockWindow)
        didUnlockFromLastCompletedSession = true
        defaults.set(unlockUntil, forKey: unlockUntilKey)
        lastErrorMessage = nil
        clearShielding()
    }

    func lockNow() {
        didUnlockFromLastCompletedSession = false
        unlockUntil = nil
        defaults.removeObject(forKey: unlockUntilKey)
        refreshShielding()
    }

    func refreshShielding() {
        if !uiTestMode {
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
        }

        if let unlockUntil, unlockUntil <= Date() {
            self.unlockUntil = nil
            didUnlockFromLastCompletedSession = false
            defaults.removeObject(forKey: unlockUntilKey)
        }

        if !hasSelection {
            didUnlockFromLastCompletedSession = false
        }

        guard hasSelection, !isUnlocked else {
            clearShielding()
            return
        }

        guard isAuthorizationApproved else {
            clearShielding()
            return
        }

        applyShielding()
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

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
}
