import SwiftUI

struct MainTabView: View {
    let appVM: AppViewModel
    @State private var selectedTab = 0

    init(appVM: AppViewModel) {
        self.appVM = appVM
        self._selectedTab = State(initialValue: Self.initialSelectedTab())
    }

    var body: some View {
        TabView(selection: $selectedTab) {
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
                        .accessibilityIdentifier("tab.settings")
                }
                .tag(4)
        }
        .tint(SPColor.green)
        .onAppear {
            Self.configureTabBarAppearance()
        }
    }

    private static var tabBarConfigured = false

    private static func initialSelectedTab() -> Int {
        if truthy(ProcessInfo.processInfo.environment["SP_UI_TEST_FORCE_PROGRESS_TAB"]) {
            return 1
        }
        return 0
    }

    private static func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }

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
