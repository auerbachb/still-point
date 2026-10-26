import Foundation

/// Launch seeds for UI tests. `SP_UI_TEST_*` environment flags pick the starting tab
/// and the first authenticated route; with none set, these are tab 0 and Home.
extension AppViewModel {
    private static func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }

    /// Initial tab index. Honors SP_UI_TEST_FORCE_SETTINGS_TAB (Settings = 4)
    /// and SP_UI_TEST_FORCE_PROGRESS_TAB (Progress = 1).
    static func defaultSelectedTab() -> Int {
        let env = ProcessInfo.processInfo.environment
        if truthy(env["SP_UI_TEST_FORCE_SETTINGS_TAB"]) { return 4 }
        if truthy(env["SP_UI_TEST_FORCE_PROGRESS_TAB"]) { return 1 }
        return 0
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
