import Foundation
import StillPointShared
import UIKit
import UserNotifications

final class PushNotificationCoordinator: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationCoordinator()

    /// Invoked when the user opens a push notification (or cold-starts from one).
    var deepLinkHandler: ((URL) -> Void)? {
        didSet {
            deliverPendingDeepLinkIfNeeded()
        }
    }

    private var pendingDeepLinkURL: URL?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        if let userInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            queueOrDeliverDeepLink(from: userInfo)
        }
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
        queueOrDeliverDeepLink(from: response.notification.request.content.userInfo)
    }

    private func queueOrDeliverDeepLink(from userInfo: [AnyHashable: Any]) {
        guard let url = deepLinkURL(from: userInfo) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.deliverDeepLink(url)
        }
    }

    private func deliverDeepLink(_ url: URL) {
        if let handler = deepLinkHandler {
            handler(url)
        } else {
            pendingDeepLinkURL = url
        }
    }

    private func deliverPendingDeepLinkIfNeeded() {
        guard let url = pendingDeepLinkURL, let handler = deepLinkHandler else { return }
        pendingDeepLinkURL = nil
        handler(url)
    }

    private func deepLinkURL(from userInfo: [AnyHashable: Any]) -> URL? {
        if let deepLink = userInfo["deepLink"] as? String, let url = URL(string: deepLink) {
            return url
        }
        if let type = userInfo["type"] as? String, type == "daily_reminder" {
            return URL(string: "stillpoint://home")
        }
        return nil
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
