import SwiftUI

struct MainTabView: View {
    let appVM: AppViewModel
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView(appVM: appVM)
                .tabItem {
                    Label("HOME", systemImage: "house")
                }
                .tag(0)

            HistoryView(appVM: appVM)
                .tabItem {
                    Label("PROGRESS", systemImage: "chart.bar")
                }
                .tag(1)

            ThoughtJournalView()
                .tabItem {
                    Label("JOURNAL", systemImage: "book")
                }
                .tag(2)

            PublicBoardView(currentUsername: appVM.currentUser?.username)
                .tabItem {
                    Label("BOARD", systemImage: "person.3")
                }
                .tag(3)

            SettingsView(appVM: appVM)
                .tabItem {
                    Label("SETTINGS", systemImage: "gearshape")
                }
                .tag(4)
        }
        .tint(SPColor.green)
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
