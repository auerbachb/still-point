import SwiftUI
import StillPointShared

struct MainTabView: View {
    @Bindable var appVM: AppViewModel

    /// #665/#703/#717: what the offline strip has to say right now, or `nil`
    /// when it has nothing — connected, with the sit safely on the device. The
    /// rule lives in the shared `OfflineIndicatorCopy` so the web strip raises
    /// and lowers on exactly the same conditions.
    private var offlineIndicatorState: OfflineIndicatorCopy.State? {
        OfflineIndicatorCopy.state(offline: appVM.isOfflineMode, sitNotStored: appVM.localSaveFailed)
    }

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
        // state; that reason clears the moment a `me()` succeeds. Scoped to the
        // tabbed shell on purpose — an active sit stays free of chrome.
        .safeAreaInset(edge: .top, spacing: 0) {
            // #703: the strip withdraws its "sits are saved" promise while a
            // local write is known to have failed. #717: that failure is not a
            // connectivity failure — a breath sit has no completion screen to
            // surface it on — so the shared rule raises the strip for it whether
            // or not the app is offline, with copy that says only what is true.
            if let state = offlineIndicatorState {
                OfflineIndicatorView(state: state)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: offlineIndicatorState)
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
