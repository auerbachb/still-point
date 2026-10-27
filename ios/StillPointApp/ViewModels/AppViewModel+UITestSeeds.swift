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

    /// UserDefaults suite for the snapshot seed's tracking-control prefs (#1014).
    /// Kept apart from `.standard` so the forced unlock never leaks into a later
    /// UI-test launch on the same simulator, where the release-gate tests expect
    /// a fresh install's locked state to be possible.
    static let snapshotTrackingControlPrefsSuite = "StillPoint.UITest.SnapshotTrackingControlPrefs"

    /// Tracking-control prefs for this launch. Under `SP_UI_TEST_SNAPSHOT_SEED`
    /// (marketing screenshots) the hold cluster must render: the canned history
    /// has no 5+ minute sit and the history backfill is skipped in UI-test mode,
    /// so the seed would otherwise leave the controls locked (#1014). Every other
    /// launch gets the normal `.standard`-backed manager.
    static func launchTrackingControlPrefsManager(
        env: [String: String] = ProcessInfo.processInfo.environment
    ) -> TrackingControlPrefsManager {
        guard truthy(env["SP_UI_TEST_MODE"]),
              truthy(env["SP_UI_TEST_SNAPSHOT_SEED"]),
              let defaults = UserDefaults(suiteName: snapshotTrackingControlPrefsSuite) else {
            return TrackingControlPrefsManager()
        }
        let manager = TrackingControlPrefsManager(defaults: defaults)
        manager.trackingControlsUnlocked = true
        manager.hideDistractionHyperfocusControls = false
        return manager
    }
}
