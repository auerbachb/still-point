import Foundation
import Testing
@testable import StillPointShared

/// Issue #749 — the signed-in shell's tabs as one typed identity, and the rule
/// for which one a new scene opens on.
struct MainTabTests {

    // MARK: - Tags and identifiers are frozen

    @Test func testRawValuesMatchTheTabViewTagsInTabBarOrder() {
        #expect(MainTab.allCases == [.home, .progress, .journal, .board, .settings])
        #expect(MainTab.allCases.map(\.rawValue) == [0, 1, 2, 3, 4])
    }

    @Test func testAccessibilityIdentifiersMatchWhatTheUITestsFind() {
        #expect(MainTab.allCases.map(\.accessibilityIdentifier) == ["tab.home", "tab.progress", "tab.journal", "tab.board", "tab.settings"])
    }

    @Test func testRawValueRoundTripsAndRejectsOutOfRangeTags() {
        for tab in MainTab.allCases {
            #expect(MainTab(rawValue: tab.rawValue) == tab)
        }
        #expect(MainTab(rawValue: -1) == nil)
        #expect(MainTab(rawValue: 5) == nil)
    }

    // MARK: - initial(forceSettings:forceProgress:)

    @Test func testOpensOnHomeWithNoSeedSet() {
        #expect(MainTab.initial(forceSettings: false, forceProgress: false) == .home)
    }

    @Test func testSettingsSeedOpensOnSettings() {
        #expect(MainTab.initial(forceSettings: true, forceProgress: false) == .settings)
    }

    @Test func testProgressSeedOpensOnProgress() {
        #expect(MainTab.initial(forceSettings: false, forceProgress: true) == .progress)
    }

    @Test func testSettingsSeedWinsWhenBothAreSet() {
        #expect(MainTab.initial(forceSettings: true, forceProgress: true) == .settings)
    }
}
