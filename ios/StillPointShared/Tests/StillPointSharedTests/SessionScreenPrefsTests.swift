import Foundation
import Testing
@testable import StillPointShared

/// Issue #75 — which optional session-screen components show, and whether the
/// choice survives into the next sit.
@Suite struct SessionScreenPrefsTests {
    /// Runs `body` against an isolated suite, then removes its persistent domain so
    /// nothing is left behind in `UserDefaults` and nothing leaks into `.standard`.
    private func withDefaults(_ body: (UserDefaults) -> Void) {
        let name = "SessionScreenPrefsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        body(defaults)
    }

    @Test func testDefaultsShowEveryComponent() {
        withDefaults { defaults in
            let prefs = SessionScreenPrefsStore.load(defaults: defaults)
            #expect(prefs == SessionScreenPrefs())
            #expect(prefs.showBlockGrid && prefs.showProgressBar && prefs.showMindStateBar && prefs.showStatusLabel)
        }
    }

    @Test func testSavedTogglesRoundTrip() {
        withDefaults { defaults in
            SessionScreenPrefsStore.write(false, for: .blockGrid, defaults: defaults)
            SessionScreenPrefsStore.write(false, for: .mindStateBar, defaults: defaults)
            SessionScreenPrefsStore.write(false, for: .statusLabel, defaults: defaults)
            #expect(SessionScreenPrefsStore.load(defaults: defaults) == SessionScreenPrefs(
                showBlockGrid: false,
                showProgressBar: true,
                showMindStateBar: false,
                showStatusLabel: false
            ))
        }
    }

    /// Launch-argument overrides (`-key NO`) reach UserDefaults as strings; they must read as hidden.
    @Test func testStringOverrideFromLaunchArgumentReadsAsHidden() {
        withDefaults { defaults in
            defaults.set("NO", forKey: SessionScreenField.progressBar.key)
            defaults.set("YES", forKey: SessionScreenField.mindStateBar.key)
            let prefs = SessionScreenPrefsStore.load(defaults: defaults)
            #expect(!prefs.showProgressBar)
            #expect(prefs.showMindStateBar)
        }
    }

    @Test func testRestoringAComponentPersists() {
        withDefaults { defaults in
            SessionScreenPrefsStore.write(false, for: .blockGrid, defaults: defaults)
            SessionScreenPrefsStore.write(true, for: .blockGrid, defaults: defaults)
            #expect(SessionScreenPrefsStore.load(defaults: defaults).showBlockGrid)
        }
    }

    /// Two Settings scenes can each hold a stale copy. Each writes only its own
    /// toggle, so neither undoes the other's change.
    @Test func testWritingOneKeyDoesNotRevertAnother() {
        withDefaults { defaults in
            SessionScreenPrefsStore.write(false, for: .progressBar, defaults: defaults)
            SessionScreenPrefsStore.write(false, for: .blockGrid, defaults: defaults)
            let prefs = SessionScreenPrefsStore.load(defaults: defaults)
            #expect(!prefs.showProgressBar)
            #expect(!prefs.showBlockGrid)
            #expect(prefs.showMindStateBar && prefs.showStatusLabel)
        }
    }

    @Test func testResetRestoresDefaults() {
        withDefaults { defaults in
            for field in SessionScreenField.allCases {
                SessionScreenPrefsStore.write(false, for: field, defaults: defaults)
            }
            SessionScreenPrefsStore.resetPersistedPrefs(defaults: defaults)
            #expect(SessionScreenPrefsStore.load(defaults: defaults) == SessionScreenPrefs())
        }
    }

    @Test func testMinimalViewHidesEveryComponent() {
        let saved = SessionScreenPrefs()
        let resolved = saved.resolved(minimal: true)
        #expect(!resolved.showBlockGrid)
        #expect(!resolved.showProgressBar)
        #expect(!resolved.showMindStateBar)
        #expect(!resolved.showStatusLabel)
    }

    @Test func testMinimalViewLeavesSavedTogglesIntact() {
        let saved = SessionScreenPrefs(showBlockGrid: false, showProgressBar: true, showMindStateBar: true, showStatusLabel: false)
        _ = saved.resolved(minimal: true)
        #expect(saved.resolved(minimal: false) == saved)
    }

    @Test func testNonMinimalResolvesToSavedToggles() {
        let saved = SessionScreenPrefs(showBlockGrid: false, showProgressBar: true, showMindStateBar: false, showStatusLabel: true)
        #expect(saved.resolved(minimal: false) == saved)
    }
}
