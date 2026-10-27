import SwiftUI

/// The tab bar's look: opaque, on the app background, scrolled or not.
///
/// #749: lifted out of `MainTabView` so the view holds no process-global state.
/// `UITabBar.appearance()` is itself process-wide, and every `WindowGroup` scene
/// builds its own `MainTabView`, so this runs once per process however many
/// times a tab shell appears.
@MainActor
enum TabBarAppearance {
    private static var isConfigured = false

    static func configureIfNeeded() {
        guard !isConfigured else { return }
        isConfigured = true
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(SPColor.bg)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}
