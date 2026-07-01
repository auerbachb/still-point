import Foundation
import StillPointShared

enum SessionDeepLinkParser {
    static func sessionType(from url: URL) -> SessionType? {
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "stillpoint" else { return nil }
        let host = (url.host ?? "").lowercased()
        guard host == "session" else { return nil }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        if path == "quick" || path == "quick-minute" {
            return .quick
        }
        if path.isEmpty {
            return .standard
        }
        return nil
    }
}
