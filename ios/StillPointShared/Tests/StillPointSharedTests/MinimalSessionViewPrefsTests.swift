import Foundation
import Testing
@testable import StillPointShared

/// Issue #669 — the "just the timer" preference must survive into the next sit
/// and stay easy to reverse.
@Suite(.serialized) final class MinimalSessionViewPrefsTests {
    init() {
        MinimalSessionViewPrefs.resetPersistedPrefs()
    }

    deinit {
        MinimalSessionViewPrefs.resetPersistedPrefs()
    }

    @Test func testDefaultIsFullSessionScreen() {
        #expect(!MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    @Test func testEnablingPersists() {
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(true)
        #expect(MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    @Test func testChoiceIsEasyToReverse() {
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(true)
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(false)
        #expect(!MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    @Test func testResetClearsThePreference() {
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(true)
        MinimalSessionViewPrefs.resetPersistedPrefs()
        #expect(!MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    /// Web reserves this exact key name in `src/lib/minimalSessionViewPrefs.ts`
    /// (`IOS_MINIMAL_SESSION_VIEW_KEY`); both clients must keep it aligned.
    @Test func testStorageKeyMatchesWebParityConstant() {
        #expect(MinimalSessionViewPrefs.minimalSessionViewKey == "sp_minimalSessionView")
    }

    @Test func testReadsBackFromUserDefaultsWrittenOutsideTheHelper() {
        UserDefaults.standard.set(true, forKey: MinimalSessionViewPrefs.minimalSessionViewKey)
        #expect(MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }
}
