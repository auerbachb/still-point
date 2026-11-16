import Foundation
import Testing
@testable import StillPointShared

/// #30: the appearance choice maps to the right forced scheme and persists under
/// its raw value, with `system` as the default.
struct ThemeModeMappingTests {

    @Test func testSystemFollowsTheDevice() {
        #expect(ThemeMode.system.forcedScheme == nil)
    }

    @Test func testLightAndDarkForceTheirScheme() {
        #expect(ThemeMode.light.forcedScheme == .light)
        #expect(ThemeMode.dark.forcedScheme == .dark)
    }

    @Test func testRawValuesAreTheStoredContract() {
        #expect(ThemeMode.system.rawValue == "system")
        #expect(ThemeMode.light.rawValue == "light")
        #expect(ThemeMode.dark.rawValue == "dark")
    }

    @Test func testAllThreeModesAreOffered() {
        #expect(ThemeMode.allCases == [.system, .light, .dark])
    }
}

/// Both suites below read and write `UserDefaults.standard[ThemePrefs.key]`. Nested
/// under one serialized parent so they never interleave; separate top-level
/// `.serialized` suites still run in parallel with each other.
@Suite(.serialized)
@MainActor
struct ThemeDefaultsSuites {

@Suite
@MainActor
struct ThemePrefsTests {

    init() {
        ThemePrefs.resetPersistedPrefs()
    }

    @Test func testAbsentValueResolvesToSystem() {
        #expect(ThemePrefs.resolve(rawValue: nil) == .system)
    }

    @Test func testUnrecognisedValueResolvesToSystem() {
        #expect(ThemePrefs.resolve(rawValue: "sepia") == .system)
        #expect(ThemePrefs.resolve(rawValue: "") == .system)
    }

    @Test func testKnownValuesResolveToTheirMode() {
        #expect(ThemePrefs.resolve(rawValue: "light") == .light)
        #expect(ThemePrefs.resolve(rawValue: "dark") == .dark)
    }

    @Test func testFreshInstallReadsSystemWithoutWriting() {
        #expect(ThemePrefs.mode == .system)
        #expect(UserDefaults.standard.object(forKey: ThemePrefs.key) == nil)
    }

    @Test func testSetModePersistsAndReadsBack() {
        ThemePrefs.setMode(.dark)
        #expect(ThemePrefs.mode == .dark)
        #expect(UserDefaults.standard.string(forKey: ThemePrefs.key) == "dark")
    }

    @Test func testResetReturnsToSystem() {
        ThemePrefs.setMode(.light)
        ThemePrefs.resetPersistedPrefs()
        #expect(ThemePrefs.mode == .system)
    }
}

@Suite
@MainActor
struct ThemeModePreferenceStoreTests {

    init() {
        ThemePrefs.resetPersistedPrefs()
    }

    @Test func testStoreReadsThePersistedChoice() {
        ThemePrefs.setMode(.light)
        #expect(ThemeModePreferenceStore().mode == .light)
    }

    @Test func testStoreWritesAndReflectsAChange() {
        let store = ThemeModePreferenceStore()
        store.setMode(.dark)
        #expect(store.mode == .dark)
        #expect(ThemePrefs.mode == .dark)
    }

    @Test func testAStoreIsSeenByAnotherInstanceReadingStorage() {
        // Two scenes built from the same storage agree on the answer.
        let first = ThemeModePreferenceStore()
        let second = ThemeModePreferenceStore()
        first.setMode(.light)
        #expect(second.mode == .light)
    }

    @Test func testSettingTheSameModeWritesNothing() {
        let store = ThemeModePreferenceStore()
        store.setMode(.system)
        #expect(UserDefaults.standard.object(forKey: ThemePrefs.key) == nil)
    }
}
}
