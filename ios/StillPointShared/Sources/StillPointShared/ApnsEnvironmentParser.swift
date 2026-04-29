import Foundation

public enum ApnsEnvironmentParser {
    public static func parse(fromProfileString profile: String) -> String? {
        guard let plistStart = profile.range(of: "<plist"),
              let plistEnd = profile.range(of: "</plist>", range: plistStart.lowerBound..<profile.endIndex) else {
            return nil
        }

        let plistString = String(profile[plistStart.lowerBound..<plistEnd.upperBound])
        guard let plistData = plistString.data(using: .utf8),
              let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any],
              let environment = entitlements["aps-environment"] as? String,
              environment == "development" || environment == "production" else {
            return nil
        }

        return environment
    }
}
