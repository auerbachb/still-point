import Foundation
import StillPointShared
import UIKit
import UserNotifications

final class PushNotificationCoordinator: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationCoordinator()

    /// Set from `RootView` so notification taps can route into the app shell.
    var onDeepLink: (@MainActor (URL) -> Void)? {
        didSet {
            deliverPendingDeepLinkIfReady()
        }
    }

    private var pendingDeepLink: URL?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func requestAuthorizationAndRegister() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error {
                print("Push notification authorization failed: \(error.localizedDescription)")
                return
            }

            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Re-uploads the device token when the user already granted permission (e.g. after login).
    func registerIfAlreadyAuthorized() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }

        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        let environment = apnsEnvironment()
        Task {
            do {
                _ = try await APIClient.shared.registerDeviceToken(
                    DeviceTokenRegistrationRequest(token: token, apnsEnvironment: environment)
                )
                DeviceTokenStore.save(token: token, apnsEnvironment: environment)
            } catch {
                print("Device token registration failed: \(error.localizedDescription)")
            }
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("Remote notification registration failed: \(error.localizedDescription)")
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        guard let deepLink = userInfo["deepLink"] as? String,
              let url = URL(string: deepLink) else {
            return
        }
        await MainActor.run {
            routeDeepLink(url)
        }
    }

    @MainActor
    private func routeDeepLink(_ url: URL) {
        if let onDeepLink {
            onDeepLink(url)
        } else {
            pendingDeepLink = url
        }
    }

    @MainActor
    func deliverPendingDeepLinkIfReady() {
        guard let url = pendingDeepLink, onDeepLink != nil else { return }
        pendingDeepLink = nil
        onDeepLink?(url)
    }

    func unregisterCurrentDeviceToken() async throws {
        guard let storedToken = DeviceTokenStore.load() else { return }
        try await APIClient.shared.unregisterDeviceToken(
            DeviceTokenRegistrationRequest(
                token: storedToken.token,
                apnsEnvironment: storedToken.apnsEnvironment
            )
        )
        DeviceTokenStore.clear()
    }

    func clearStoredDeviceToken() {
        DeviceTokenStore.clear()
    }

    private func apnsEnvironment() -> String {
        guard let profilePath = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
              let profile = try? String(contentsOfFile: profilePath, encoding: .isoLatin1) else {
            return "production"
        }

        guard let environment = ApnsEnvironmentParser.parse(fromProfileString: profile) else {
            assertionFailure("Unable to read APNs environment from embedded provisioning profile")
            return "production"
        }

        return environment
    }
}
