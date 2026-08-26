import XCTest
@testable import StillPointShared

/// Issue #669 — the "just the timer" preference must survive into the next sit
/// and stay easy to reverse.
final class MinimalSessionViewPrefsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MinimalSessionViewPrefs.resetPersistedPrefs()
    }

    override func tearDown() {
        MinimalSessionViewPrefs.resetPersistedPrefs()
        super.tearDown()
    }

    func testDefaultIsFullSessionScreen() {
        XCTAssertFalse(MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    func testEnablingPersists() {
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(true)
        XCTAssertTrue(MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    func testChoiceIsEasyToReverse() {
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(true)
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(false)
        XCTAssertFalse(MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    func testResetClearsThePreference() {
        MinimalSessionViewPrefs.setMinimalSessionViewEnabled(true)
        MinimalSessionViewPrefs.resetPersistedPrefs()
        XCTAssertFalse(MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }

    /// Web reserves this exact key name in `src/lib/minimalSessionViewPrefs.ts`
    /// (`IOS_MINIMAL_SESSION_VIEW_KEY`); both clients must keep it aligned.
    func testStorageKeyMatchesWebParityConstant() {
        XCTAssertEqual(MinimalSessionViewPrefs.minimalSessionViewKey, "sp_minimalSessionView")
    }

    func testReadsBackFromUserDefaultsWrittenOutsideTheHelper() {
        UserDefaults.standard.set(true, forKey: MinimalSessionViewPrefs.minimalSessionViewKey)
        XCTAssertTrue(MinimalSessionViewPrefs.isMinimalSessionViewEnabled)
    }
}
