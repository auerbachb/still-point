import XCTest
@testable import StillPointShared

/// Issue #730 — the wake lock is on unless the user turned it off. The whole point
/// of the resolver is that "never set" and an explicit `false` must not collapse
/// into the same value, which is exactly what `UserDefaults.bool(forKey:)` does.
final class WakeLockPrefsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        WakeLockPrefs.resetPersistedPrefs()
    }

    override func tearDown() {
        WakeLockPrefs.resetPersistedPrefs()
        super.tearDown()
    }

    // MARK: - Pure resolver

    func testUnsetResolvesToOn() {
        XCTAssertTrue(WakeLockPrefs.resolveKeepScreenAwake(stored: nil))
    }

    func testExplicitOnResolvesToOn() {
        XCTAssertTrue(WakeLockPrefs.resolveKeepScreenAwake(stored: true))
    }

    func testExplicitOffResolvesToOff() {
        XCTAssertFalse(WakeLockPrefs.resolveKeepScreenAwake(stored: false))
    }

    // MARK: - UserDefaults-backed reads

    func testDefaultIsScreenStaysAwake() {
        XCTAssertNil(WakeLockPrefs.storedKeepScreenAwake)
        XCTAssertTrue(WakeLockPrefs.isKeepScreenAwakeEnabled)
    }

    /// The regression this issue exists to prevent: an explicit opt-out must not be
    /// re-read as "unset" and silently flipped back on by the new default.
    func testExplicitOptOutSurvivesTheNewDefault() {
        WakeLockPrefs.setKeepScreenAwakeEnabled(false)

        XCTAssertEqual(WakeLockPrefs.storedKeepScreenAwake, false)
        XCTAssertFalse(WakeLockPrefs.isKeepScreenAwakeEnabled)
    }

    func testExplicitOptInPersists() {
        WakeLockPrefs.setKeepScreenAwakeEnabled(true)

        XCTAssertEqual(WakeLockPrefs.storedKeepScreenAwake, true)
        XCTAssertTrue(WakeLockPrefs.isKeepScreenAwakeEnabled)
    }

    func testChoiceIsEasyToReverse() {
        WakeLockPrefs.setKeepScreenAwakeEnabled(false)
        WakeLockPrefs.setKeepScreenAwakeEnabled(true)

        XCTAssertTrue(WakeLockPrefs.isKeepScreenAwakeEnabled)
    }

    /// `bool(forKey:)` reports `false` for both "never set" and an explicit off; the
    /// object read is what keeps them apart. Without this the default flip would be
    /// unrepresentable.
    func testUnsetIsDistinguishableFromExplicitOff() {
        XCTAssertNil(WakeLockPrefs.storedKeepScreenAwake)
        XCTAssertFalse(UserDefaults.standard.bool(forKey: WakeLockPrefs.keepScreenAwakeKey))

        WakeLockPrefs.setKeepScreenAwakeEnabled(false)

        XCTAssertEqual(WakeLockPrefs.storedKeepScreenAwake, false)
        XCTAssertFalse(UserDefaults.standard.bool(forKey: WakeLockPrefs.keepScreenAwakeKey))
    }

    func testResetReturnsToTheUnsetDefault() {
        WakeLockPrefs.setKeepScreenAwakeEnabled(false)
        WakeLockPrefs.resetPersistedPrefs()

        XCTAssertNil(WakeLockPrefs.storedKeepScreenAwake)
        XCTAssertTrue(WakeLockPrefs.isKeepScreenAwakeEnabled)
    }

    func testReadsBackFromUserDefaultsWrittenOutsideTheHelper() {
        UserDefaults.standard.set(false, forKey: WakeLockPrefs.keepScreenAwakeKey)
        XCTAssertFalse(WakeLockPrefs.isKeepScreenAwakeEnabled)
    }

    /// A value of the wrong type is not a choice, so it takes the default — matching
    /// web's invalid-shape fallback in `loadWakeLockPrefs()`.
    func testNonBooleanStoredValueTakesTheDefault() {
        UserDefaults.standard.set("nope", forKey: WakeLockPrefs.keepScreenAwakeKey)

        XCTAssertNil(WakeLockPrefs.storedKeepScreenAwake)
        XCTAssertTrue(WakeLockPrefs.isKeepScreenAwakeEnabled)
    }

    /// The app target reads and writes this exact key via `SessionIdleTimerController`;
    /// renaming it would silently reset every existing user's choice.
    func testStorageKeyMatchesTheAppTargetConstant() {
        XCTAssertEqual(WakeLockPrefs.keepScreenAwakeKey, "sp_keepScreenAwakeDuringSession")
    }
}
