import Foundation
import Testing
@testable import StillPointShared

/// #1072: `WakeLockPrefsTests` and `WakeLockPreferenceStoreTests` both read and
/// write the process-wide `sp_keepScreenAwakeDuringSession` key in
/// `UserDefaults.standard`. swift-testing runs suites in parallel, and
/// `.serialized` only orders tests inside one suite tree, so both suites nest
/// under this parent to keep them from racing each other.
@Suite(.serialized)
enum WakeLockSerializedSuites {}

extension WakeLockSerializedSuites {
    /// Issue #730 — the wake lock is on unless the user turned it off. The whole point
    /// of the resolver is that "never set" and an explicit `false` must not collapse
    /// into the same value, which is exactly what `UserDefaults.bool(forKey:)` does.
    final class WakeLockPrefsTests {
        init() {
            WakeLockPrefs.resetPersistedPrefs()
        }

        deinit {
            WakeLockPrefs.resetPersistedPrefs()
        }

        // MARK: - Pure resolver

        @Test func testUnsetResolvesToOn() {
            #expect(WakeLockPrefs.resolveKeepScreenAwake(stored: nil))
        }

        @Test func testExplicitOnResolvesToOn() {
            #expect(WakeLockPrefs.resolveKeepScreenAwake(stored: true))
        }

        @Test func testExplicitOffResolvesToOff() {
            #expect(!WakeLockPrefs.resolveKeepScreenAwake(stored: false))
        }

        // MARK: - UserDefaults-backed reads

        @Test func testDefaultIsScreenStaysAwake() {
            #expect(WakeLockPrefs.storedKeepScreenAwake == nil)
            #expect(WakeLockPrefs.isKeepScreenAwakeEnabled)
        }

        /// The regression this issue exists to prevent: an explicit opt-out must not be
        /// re-read as "unset" and silently flipped back on by the new default.
        @Test func testExplicitOptOutSurvivesTheNewDefault() {
            WakeLockPrefs.setKeepScreenAwakeEnabled(false)

            #expect(WakeLockPrefs.storedKeepScreenAwake == false)
            #expect(!WakeLockPrefs.isKeepScreenAwakeEnabled)
        }

        @Test func testExplicitOptInPersists() {
            WakeLockPrefs.setKeepScreenAwakeEnabled(true)

            #expect(WakeLockPrefs.storedKeepScreenAwake == true)
            #expect(WakeLockPrefs.isKeepScreenAwakeEnabled)
        }

        @Test func testChoiceIsEasyToReverse() {
            WakeLockPrefs.setKeepScreenAwakeEnabled(false)
            WakeLockPrefs.setKeepScreenAwakeEnabled(true)

            #expect(WakeLockPrefs.isKeepScreenAwakeEnabled)
        }

        /// `bool(forKey:)` reports `false` for both "never set" and an explicit off; the
        /// object read is what keeps them apart. Without this the default flip would be
        /// unrepresentable.
        @Test func testUnsetIsDistinguishableFromExplicitOff() {
            #expect(WakeLockPrefs.storedKeepScreenAwake == nil)
            #expect(!UserDefaults.standard.bool(forKey: WakeLockPrefs.keepScreenAwakeKey))

            WakeLockPrefs.setKeepScreenAwakeEnabled(false)

            #expect(WakeLockPrefs.storedKeepScreenAwake == false)
            #expect(!UserDefaults.standard.bool(forKey: WakeLockPrefs.keepScreenAwakeKey))
        }

        @Test func testResetReturnsToTheUnsetDefault() {
            WakeLockPrefs.setKeepScreenAwakeEnabled(false)
            WakeLockPrefs.resetPersistedPrefs()

            #expect(WakeLockPrefs.storedKeepScreenAwake == nil)
            #expect(WakeLockPrefs.isKeepScreenAwakeEnabled)
        }

        @Test func testReadsBackFromUserDefaultsWrittenOutsideTheHelper() {
            UserDefaults.standard.set(false, forKey: WakeLockPrefs.keepScreenAwakeKey)
            #expect(!WakeLockPrefs.isKeepScreenAwakeEnabled)
        }

        /// A value of the wrong type is not a choice, so it takes the default — matching
        /// web's invalid-shape fallback in `loadWakeLockPrefs()`.
        @Test func testNonBooleanStoredValueTakesTheDefault() {
            UserDefaults.standard.set("nope", forKey: WakeLockPrefs.keepScreenAwakeKey)

            #expect(WakeLockPrefs.storedKeepScreenAwake == nil)
            #expect(WakeLockPrefs.isKeepScreenAwakeEnabled)
        }

        /// The app target reads and writes this exact key via `SessionIdleTimerController`;
        /// renaming it would silently reset every existing user's choice.
        @Test func testStorageKeyMatchesTheAppTargetConstant() {
            #expect(WakeLockPrefs.keepScreenAwakeKey == "sp_keepScreenAwakeDuringSession")
        }
    }
}
