import SwiftUI

struct MainTabView: View {
    @Bindable var appVM: AppViewModel

    var body: some View {
        TabView(selection: $appVM.selectedTab) {
            HomeView(appVM: appVM)
                .tabItem {
                    Label("HOME", systemImage: "house")
                        .accessibilityIdentifier("tab.home")
                }
                .tag(0)

            HistoryView(appVM: appVM)
                .tabItem {
                    Label("PROGRESS", systemImage: "chart.bar")
                        .accessibilityIdentifier("tab.progress")
                }
                .tag(1)

            ThoughtJournalView()
                .tabItem {
                    Label("JOURNAL", systemImage: "book")
                        .accessibilityIdentifier("tab.journal")
                }
                .tag(2)

            PublicBoardView(currentUsername: appVM.currentUser?.username)
                .tabItem {
                    Label("BOARD", systemImage: "person.3")
                        .accessibilityIdentifier("tab.board")
                }
                .tag(3)

            SettingsView(appVM: appVM)
                .tabItem {
                    Label("SETTINGS", systemImage: "gearshape")
                        .accessibilityIdentifier("tab.settings")
                }
                .tag(4)
        }
        .tint(SPColor.green)
        // #665: shown across every tab while the app runs from cached identity and
        // state; it clears the moment a `me()` succeeds. Scoped to the tabbed
        // shell on purpose — an active sit stays free of chrome.
        .safeAreaInset(edge: .top, spacing: 0) {
            if appVM.isOfflineMode {
                OfflineIndicatorView()
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: appVM.isOfflineMode)
        .onAppear {
            Self.configureTabBarAppearance()
        }
    }

    private static var tabBarConfigured = false

    private static func configureTabBarAppearance() {
        guard !tabBarConfigured else { return }
        tabBarConfigured = true
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(SPColor.bg)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}
