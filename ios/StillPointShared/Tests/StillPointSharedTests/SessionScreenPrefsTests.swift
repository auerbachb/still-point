import Foundation
import Testing
@testable import StillPointShared

/// Issue #75 — which optional session-screen components show, and whether the
/// choice survives into the next sit.
@Suite struct SessionScreenPrefsTests {
    /// An isolated suite per test, so nothing leaks into `UserDefaults.standard`.
    private func makeDefaults() -> UserDefaults {
        let name = "SessionScreenPrefsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func testDefaultsShowEveryComponent() {
        let prefs = SessionScreenPrefsStore.load(defaults: makeDefaults())
        #expect(prefs == SessionScreenPrefs())
        #expect(prefs.showBlockGrid && prefs.showProgressBar && prefs.showMindStateBar && prefs.showStatusLabel)
    }

    @Test func testSavedTogglesRoundTrip() {
        let defaults = makeDefaults()
        let hidden = SessionScreenPrefs(
            showBlockGrid: false,
            showProgressBar: true,
            showMindStateBar: false,
            showStatusLabel: false
        )
        SessionScreenPrefsStore.save(hidden, defaults: defaults)
        #expect(SessionScreenPrefsStore.load(defaults: defaults) == hidden)
    }

    @Test func testRestoringAComponentPersists() {
        let defaults = makeDefaults()
        SessionScreenPrefsStore.save(SessionScreenPrefs(showBlockGrid: false), defaults: defaults)
        SessionScreenPrefsStore.save(SessionScreenPrefs(showBlockGrid: true), defaults: defaults)
        #expect(SessionScreenPrefsStore.load(defaults: defaults).showBlockGrid)
    }

    @Test func testResetRestoresDefaults() {
        let defaults = makeDefaults()
        SessionScreenPrefsStore.save(
            SessionScreenPrefs(showBlockGrid: false, showProgressBar: false, showMindStateBar: false, showStatusLabel: false),
            defaults: defaults
        )
        SessionScreenPrefsStore.resetPersistedPrefs(defaults: defaults)
        #expect(SessionScreenPrefsStore.load(defaults: defaults) == SessionScreenPrefs())
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
