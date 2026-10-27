import SwiftUI
import StillPointShared

struct MainTabView: View {
    @Bindable var appVM: AppViewModel

    var body: some View {
        TabView(selection: $appVM.selectedTab) {
            HomeView(appVM: appVM)
                .tabItem {
                    Label("HOME", systemImage: "house")
                        .accessibilityIdentifier(MainTab.home.accessibilityIdentifier)
                }
                .tag(MainTab.home.rawValue)

            HistoryView(appVM: appVM)
                .tabItem {
                    Label("PROGRESS", systemImage: "chart.bar")
                        .accessibilityIdentifier(MainTab.progress.accessibilityIdentifier)
                }
                .tag(MainTab.progress.rawValue)

            ThoughtJournalView()
                .tabItem {
                    Label("JOURNAL", systemImage: "book")
                        .accessibilityIdentifier(MainTab.journal.accessibilityIdentifier)
                }
                .tag(MainTab.journal.rawValue)

            PublicBoardView(currentUsername: appVM.currentUser?.username)
                .tabItem {
                    Label("BOARD", systemImage: "person.3")
                        .accessibilityIdentifier(MainTab.board.accessibilityIdentifier)
                }
                .tag(MainTab.board.rawValue)

            SettingsView(appVM: appVM)
                .tabItem {
                    Label("SETTINGS", systemImage: "gearshape")
                        .accessibilityIdentifier(MainTab.settings.accessibilityIdentifier)
                }
                .tag(MainTab.settings.rawValue)
        }
        .tint(SPColor.green)
        // #665: shown across every tab while the app runs from cached identity and
        // state; that reason clears the moment a `me()` succeeds. Scoped to the
        // tabbed shell on purpose — an active sit stays free of chrome. What the
        // strip says, and whether it shows at all, is `appVM.offlineIndicatorState`.
        .safeAreaInset(edge: .top, spacing: 0) {
            if let state = appVM.offlineIndicatorState {
                OfflineIndicatorView(state: state)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: appVM.offlineIndicatorState)
        .onAppear {
            TabBarAppearance.configureIfNeeded()
        }
    }
}
