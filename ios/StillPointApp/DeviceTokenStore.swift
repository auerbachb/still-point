import Foundation

struct StoredDeviceToken: Sendable {
    let token: String
    let apnsEnvironment: String
}

enum DeviceTokenStore {
    private static let tokenKey = "StillPoint.DeviceToken.token"
    private static let environmentKey = "StillPoint.DeviceToken.apnsEnvironment"

    static func load() -> StoredDeviceToken? {
        let defaults = UserDefaults.standard
        guard let token = defaults.string(forKey: tokenKey),
              let environment = defaults.string(forKey: environmentKey),
              !token.isEmpty,
              !environment.isEmpty else {
            return nil
        }
        return StoredDeviceToken(token: token, apnsEnvironment: environment)
    }

    static func save(token: String, apnsEnvironment: String) {
        let defaults = UserDefaults.standard
        defaults.set(token, forKey: tokenKey)
        defaults.set(apnsEnvironment, forKey: environmentKey)
    }

    static func clear() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: tokenKey)
        defaults.removeObject(forKey: environmentKey)
    }
}
