import Foundation
import StillPointShared
import UIKit
import UserNotifications

@MainActor
final class PushNotificationCoordinator: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationCoordinator()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func requestAuthorizationAndRegister() {
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

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        let environment = apnsEnvironment()
        Task {
            do {
                try await APIClient.shared.registerDeviceToken(
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

    func unregisterCurrentDeviceToken() async {
        guard let storedToken = DeviceTokenStore.load() else { return }
        do {
            try await APIClient.shared.unregisterDeviceToken(
                DeviceTokenRegistrationRequest(
                    token: storedToken.token,
                    apnsEnvironment: storedToken.apnsEnvironment
                )
            )
            DeviceTokenStore.clear()
        } catch {
            print("Device token unregister failed: \(error.localizedDescription)")
        }
    }

    func clearStoredDeviceToken() {
        DeviceTokenStore.clear()
    }

    private func apnsEnvironment() -> String {
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }
}
