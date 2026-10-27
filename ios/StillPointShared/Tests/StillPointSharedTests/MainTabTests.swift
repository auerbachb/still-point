import XCTest
@testable import StillPointShared

/// Issue #749 — the signed-in shell's tabs as one typed identity, and the rule
/// for which one a new scene opens on.
final class MainTabTests: XCTestCase {

    // MARK: - Tags and identifiers are frozen

    func testRawValuesMatchTheTabViewTagsInTabBarOrder() {
        XCTAssertEqual(MainTab.allCases, [.home, .progress, .journal, .board, .settings])
        XCTAssertEqual(MainTab.allCases.map(\.rawValue), [0, 1, 2, 3, 4])
    }

    func testAccessibilityIdentifiersMatchWhatTheUITestsFind() {
        XCTAssertEqual(
            MainTab.allCases.map(\.accessibilityIdentifier),
            ["tab.home", "tab.progress", "tab.journal", "tab.board", "tab.settings"]
        )
    }

    func testRawValueRoundTripsAndRejectsOutOfRangeTags() {
        for tab in MainTab.allCases {
            XCTAssertEqual(MainTab(rawValue: tab.rawValue), tab)
        }
        XCTAssertNil(MainTab(rawValue: -1))
        XCTAssertNil(MainTab(rawValue: 5))
    }

    // MARK: - initial(forceSettings:forceProgress:)

    func testOpensOnHomeWithNoSeedSet() {
        XCTAssertEqual(MainTab.initial(forceSettings: false, forceProgress: false), .home)
    }

    func testSettingsSeedOpensOnSettings() {
        XCTAssertEqual(MainTab.initial(forceSettings: true, forceProgress: false), .settings)
    }

    func testProgressSeedOpensOnProgress() {
        XCTAssertEqual(MainTab.initial(forceSettings: false, forceProgress: true), .progress)
    }

    func testSettingsSeedWinsWhenBothAreSet() {
        XCTAssertEqual(MainTab.initial(forceSettings: true, forceProgress: true), .settings)
    }
}
