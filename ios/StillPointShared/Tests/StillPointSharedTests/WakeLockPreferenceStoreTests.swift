import Foundation
import Testing
@testable import StillPointShared

extension WakeLockSerializedSuites {
    /// Issue #742 — the wake-lock preference reaches every `WindowGroup` scene from one
    /// shared object instead of being snapshotted into each scene's `AppViewModel`.
    ///
    /// Two properties carry the fix, and both are asserted here rather than inferred:
    /// a read always resolves storage (so no scene can render a value storage has since
    /// left behind), and only a real change writes (so one tap is one write, and an
    /// install that has never touched the setting still has no stored value — the
    /// #730 opt-out default depends on that absence).
    @MainActor
    final class WakeLockPreferenceStoreTests {
        init() {
            WakeLockPrefs.resetPersistedPrefs()
        }

        deinit {
            WakeLockPrefs.resetPersistedPrefs()
        }

        // MARK: - Reading

        @Test func testUnsetInstallReadsTheOnDefault() {
            #expect(WakeLockPreferenceStore().isEnabled)
        }

        @Test func testReadResolvesStorageRatherThanACachedMirror() {
            let store = WakeLockPreferenceStore()
            #expect(store.isEnabled, "seeded from the unset default")

            // Someone else writes the key — the UI-test reset path does exactly this,
            // and so would any future writer that never learns about the store. A
            // cached mirror would keep answering `true` here; resolving on read cannot.
            WakeLockPrefs.setKeepScreenAwakeEnabled(false)

            #expect(!store.isEnabled, "a read after an outside write sees the write")
        }

        @Test func testReadingNeverWritesTheKey() {
            let store = WakeLockPreferenceStore()
            for _ in 0..<5 { _ = store.isEnabled }

            #expect(
                WakeLockPrefs.storedKeepScreenAwake == nil,
                "reading must leave 'never set' unset — #730's default is the absence of a value"
            )
        }

        // MARK: - Writing

        @Test func testSetRecordsAnExplicitOptOut() {
            let store = WakeLockPreferenceStore()
            store.setEnabled(false)

            #expect(WakeLockPrefs.storedKeepScreenAwake == false)
            #expect(!store.isEnabled)
        }

        @Test func testSetToTheResolvedDefaultOnAnUntouchedInstallWritesNothing() {
            let store = WakeLockPreferenceStore()
            store.setEnabled(true)

            #expect(
                WakeLockPrefs.storedKeepScreenAwake == nil,
                "materialising the default would turn 'never set' into a choice the user never made"
            )
            #expect(store.isEnabled)
        }

        @Test func testRepeatedSetsOfTheSameValueLeaveTheStoredChoiceIntact() {
            let store = WakeLockPreferenceStore()
            store.setEnabled(false)
            store.setEnabled(false)
            store.setEnabled(false)

            #expect(WakeLockPrefs.storedKeepScreenAwake == false)
            #expect(!store.isEnabled)
        }

        @Test func testOptOutThenBackOnIsRecordedExplicitly() {
            let store = WakeLockPreferenceStore()
            store.setEnabled(false)
            store.setEnabled(true)

            #expect(
                WakeLockPrefs.storedKeepScreenAwake == true,
                "turning it back on after an explicit opt-out is itself an explicit choice"
            )
            #expect(store.isEnabled)
        }

        // MARK: - Multi-window

        /// The scenario from the issue: two scenes, each with its own `AppViewModel`,
        /// both reading the shared store. A change made through one is visible to the
        /// other immediately — which is what the second window's `Toggle` renders.
        @Test func testAChangeInOneSceneIsVisibleToAnother() {
            let windowA = WakeLockPreferenceStore.shared
            let windowB = WakeLockPreferenceStore.shared
            #expect(windowA === windowB, "every scene reads one instance, not a copy each")

            windowA.setEnabled(false)
            #expect(!windowB.isEnabled)

            windowA.setEnabled(true)
            #expect(windowB.isEnabled)
        }
    }
}
