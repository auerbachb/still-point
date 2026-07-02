import Foundation

enum BuddyInviteTokenParser {
    static func token(from raw: String, allowRawFallback: Bool) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let url = URL(string: trimmed), let token = token(from: url) {
            return token
        }

        if let buddy = tokenFromBuddyQueryFragment(in: trimmed) {
            return buddy
        }

        return allowRawFallback ? trimmed : nil
    }

    static func token(from url: URL) -> String? {
        if let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            if let buddy = queryValue(named: "buddy", in: components) {
                return buddy
            }

            if isBuddyRoute(components), let token = queryValue(named: "token", in: components) {
                return token
            }
        }

        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()
        if scheme == "stillpoint" && host == "buddy" {
            let token = url.path
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return token.isEmpty ? nil : token
        }

        return nil
    }

    private static func queryValue(named name: String, in components: URLComponents) -> String? {
        guard let value = components.queryItems?.first(where: { $0.name == name })?.value?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func isBuddyRoute(_ components: URLComponents) -> Bool {
        let host = (components.host ?? "").lowercased()
        let path = components.path.lowercased()
        return host == "buddy" || path == "/buddy" || path.hasPrefix("/buddy/") || path.contains("/invite/buddy")
    }

    private static func tokenFromBuddyQueryFragment(in raw: String) -> String? {
        if raw.hasPrefix("buddy=") {
            return valueAfterParameterPrefix("buddy=", in: raw)
        }
        if let range = raw.range(of: "?buddy=") {
            return valueAfterParameterPrefix("?buddy=", in: String(raw[range.lowerBound...]))
        }
        if let range = raw.range(of: "&buddy=") {
            return valueAfterParameterPrefix("&buddy=", in: String(raw[range.lowerBound...]))
        }
        return nil
    }

    private static func valueAfterParameterPrefix(_ prefix: String, in raw: String) -> String? {
        guard let range = raw.range(of: prefix) else { return nil }
        let rest = raw[range.upperBound...]
        let value = rest.split(separator: "&", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
