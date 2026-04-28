import SwiftUI
import SwiftData
import StillPointShared

@main
struct StillPointApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [User.self, Session.self, Thought.self])
    }
}
