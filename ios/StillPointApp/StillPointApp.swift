import SwiftUI
import SwiftData
import StillPointShared

@main
struct StillPointApp: App {
    @UIApplicationDelegateAdaptor(PushNotificationCoordinator.self) private var pushNotificationCoordinator

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [User.self, Session.self, Thought.self])
    }
}
