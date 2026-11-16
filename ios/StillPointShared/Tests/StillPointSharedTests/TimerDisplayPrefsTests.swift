import Foundation
import Testing
@testable import StillPointShared

/// #1190 — the sand-carrier display preference is opt-in, persists like the
/// minimal session view preference, and is easy to reverse.
@Suite(.serialized) final class TimerDisplayPrefsTests {
    init() {
        TimerDisplayPrefs.resetPersistedPrefs()
    }

    deinit {
        TimerDisplayPrefs.resetPersistedPrefs()
    }

    @Test func testDefaultKeepsDigits() {
        #expect(!TimerDisplayPrefs.isSandAnimationEnabled)
    }

    @Test func testEnablingPersists() {
        TimerDisplayPrefs.setSandAnimationEnabled(true)
        #expect(TimerDisplayPrefs.isSandAnimationEnabled)
    }

    @Test func testChoiceIsEasyToReverse() {
        TimerDisplayPrefs.setSandAnimationEnabled(true)
        TimerDisplayPrefs.setSandAnimationEnabled(false)
        #expect(!TimerDisplayPrefs.isSandAnimationEnabled)
    }

    @Test func testResetClearsThePreference() {
        TimerDisplayPrefs.setSandAnimationEnabled(true)
        TimerDisplayPrefs.resetPersistedPrefs()
        #expect(!TimerDisplayPrefs.isSandAnimationEnabled)
    }

    /// The key name mirrors the web `sandAnimation` field; both clients must keep it aligned.
    @Test func testStorageKeyIsStable() {
        #expect(TimerDisplayPrefs.sandAnimationKey == "sp_sandAnimation")
    }
}
