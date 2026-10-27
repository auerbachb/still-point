import Foundation
import StillPointShared

/// Launch seeds for UI tests. `SP_UI_TEST_*` environment flags pick the starting tab
/// and the first authenticated route; with none set, these are the Home tab and Home.
extension AppViewModel {
    private static func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }

    /// Initial tab, as a `MainTab` raw value. Reads SP_UI_TEST_FORCE_SETTINGS_TAB
    /// and SP_UI_TEST_FORCE_PROGRESS_TAB; which of them wins is
    /// `MainTab.initial(forceSettings:forceProgress:)`.
    static func defaultSelectedTab() -> Int {
        let env = ProcessInfo.processInfo.environment
        return MainTab.initial(
            forceSettings: truthy(env["SP_UI_TEST_FORCE_SETTINGS_TAB"]),
            forceProgress: truthy(env["SP_UI_TEST_FORCE_PROGRESS_TAB"])
        ).rawValue
    }

    /// Boot destination for authenticated UI-test launches. Seed knobs are
    /// mutually exclusive; the first match wins.
    static func initialAuthenticatedView(from env: [String: String]) -> AppView {
        if truthy(env["SP_UI_TEST_FORCE_START_SESSION"]) {
            return .session(type: .standard, track: .primary)
        }
        if truthy(env["SP_UI_TEST_FORCE_BREATH_COUNTING"]) {
            return .breathCounting
        }
        if truthy(env["SP_UI_TEST_FORCE_BUDDY_HUB"]) {
            return .buddyHub
        }
        return .home
    }
}
