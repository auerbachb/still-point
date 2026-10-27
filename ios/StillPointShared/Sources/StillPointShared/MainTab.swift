import Foundation

/// #749: the five tabs of the signed-in shell (`MainTabView`), as one typed identity.
///
/// The raw value is the `TabView` selection tag, and so the value
/// `AppViewModel.selectedTab` holds; the identifier is what the UI tests find a
/// tab button by. Both are frozen: `StillPointAppUITests` depends on the
/// identifiers, and on tab-bar positions that match these raw values.
///
/// Named `MainTab` rather than `Tab` because SwiftUI (iOS 18 SDK) exports its
/// own `Tab`, which would make every unqualified `Tab` ambiguous in a SwiftUI
/// file that also imports this package.
///
/// Free of SwiftUI / UIKit so it compiles and runs under `swift test` on macOS.
public enum MainTab: Int, CaseIterable, Sendable {
    case home = 0
    case progress = 1
    case journal = 2
    case board = 3
    case settings = 4

    /// The tab button's accessibility identifier.
    public var accessibilityIdentifier: String {
        switch self {
        case .home: return "tab.home"
        case .progress: return "tab.progress"
        case .journal: return "tab.journal"
        case .board: return "tab.board"
        case .settings: return "tab.settings"
        }
    }

    /// The tab a new scene opens on.
    ///
    /// Home, unless a UI-test launch seed forces another: `forceSettings`
    /// (`SP_UI_TEST_FORCE_SETTINGS_TAB`) wins over `forceProgress`
    /// (`SP_UI_TEST_FORCE_PROGRESS_TAB`) when both are set. The caller reads the
    /// seeds; this takes them as plain facts so it needs no process environment.
    public static func initial(forceSettings: Bool, forceProgress: Bool) -> MainTab {
        if forceSettings { return .settings }
        if forceProgress { return .progress }
        return .home
    }
}
