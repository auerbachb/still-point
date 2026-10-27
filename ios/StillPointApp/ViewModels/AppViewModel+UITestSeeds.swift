import Foundation
import StillPointShared

/// Launch seeds for UI tests. `SP_UI_TEST_*` environment flags pick the starting tab
/// and the first authenticated route; with none set, these are the Home tab and Home.
///
/// Adding a seed: name its key in `SeedKey`, then read it with `flag(_:in:)`. A new
/// boot destination is one row in `authenticatedRouteSeeds` — no new branch.
extension AppViewModel {
    /// Environment keys these seeds read. Kept in one place so a new seed is a
    /// one-line addition and a key is never spelled twice.
    private enum SeedKey {
        static let uiTestMode = "SP_UI_TEST_MODE"
        static let snapshotSeed = "SP_UI_TEST_SNAPSHOT_SEED"
        static let forceSettingsTab = "SP_UI_TEST_FORCE_SETTINGS_TAB"
        static let forceProgressTab = "SP_UI_TEST_FORCE_PROGRESS_TAB"
        static let forceStartSession = "SP_UI_TEST_FORCE_START_SESSION"
        static let forceBreathCounting = "SP_UI_TEST_FORCE_BREATH_COUNTING"
        static let forceBuddyHub = "SP_UI_TEST_FORCE_BUDDY_HUB"
    }

    private static let truthyValues: Set<String> = ["1", "true", "yes", "on"]

    /// Whether `key` is set to a truthy value (`1`, `true`, `yes`, `on`; any case).
    private static func flag(_ key: String, in env: [String: String]) -> Bool {
        guard let value = env[key] else { return false }
        return truthyValues.contains(value.lowercased())
    }

    /// Initial tab, as a `MainTab` raw value. Reads SP_UI_TEST_FORCE_SETTINGS_TAB
    /// and SP_UI_TEST_FORCE_PROGRESS_TAB; which of them wins is
    /// `MainTab.initial(forceSettings:forceProgress:)`.
    static func defaultSelectedTab(
        env: [String: String] = ProcessInfo.processInfo.environment
    ) -> Int {
        MainTab.initial(
            forceSettings: flag(SeedKey.forceSettingsTab, in: env),
            forceProgress: flag(SeedKey.forceProgressTab, in: env)
        ).rawValue
    }

    /// Authenticated boot-destination seeds, in priority order. The knobs are
    /// mutually exclusive; the first set one wins.
    private static var authenticatedRouteSeeds: [(key: String, view: AppView)] {
        [
            (SeedKey.forceStartSession, .session(type: .standard, track: .primary, combined: false)),
            (SeedKey.forceBreathCounting, .breathCounting),
            (SeedKey.forceBuddyHub, .buddyHub),
        ]
    }

    /// Boot destination for authenticated UI-test launches: the first seed in
    /// `authenticatedRouteSeeds` that is set, else Home.
    static func initialAuthenticatedView(from env: [String: String]) -> AppView {
        authenticatedRouteSeeds.first { flag($0.key, in: env) }?.view ?? .home
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
        guard flag(SeedKey.uiTestMode, in: env),
              flag(SeedKey.snapshotSeed, in: env),
              let defaults = UserDefaults(suiteName: snapshotTrackingControlPrefsSuite) else {
            return TrackingControlPrefsManager()
        }
        let manager = TrackingControlPrefsManager(defaults: defaults)
        manager.trackingControlsUnlocked = true
        manager.hideDistractionHyperfocusControls = false
        return manager
    }
}
