import Foundation

/// #832: where a notification link (`stillpoint://home`, `stillpoint://friends`,
/// `stillpoint://log-reason`) sends the user. The decision half of
/// `handleNotificationDeepLink`, which applies the side effects for the route
/// this returns.
///
/// A pure classification of the URL's scheme and host. It reads neither the path
/// nor the query, and it does not parse the log-reason date: the app does that
/// with `LogReasonDeepLinkParser`, which falls back to today's date. The
/// "friends is web-only, land on Home" policy also stays in the app, so a future
/// iOS friends tab needs an app change only.
public enum NotificationDeepLinkRoute: Equatable, Sendable {
    case home
    case friends
    case logReason

    /// The route for `url`, or `nil` when it is not a notification link.
    ///
    /// The scheme and host are matched case-insensitively, and a missing one reads
    /// as empty. Only the `stillpoint` scheme is recognized.
    ///
    /// `nil` means "not mine": the caller continues to the next route
    /// (buddy-invite parsing), so the session (`session`) and buddy (`buddy`) hosts
    /// return `nil` here. A non-`nil` result claims the URL even when navigation
    /// is then suppressed, for example mid-sit or signed out, so a recognized host
    /// never falls through to buddy parsing.
    public static func route(for url: URL) -> NotificationDeepLinkRoute? {
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "stillpoint" else { return nil }
        switch (url.host ?? "").lowercased() {
        case "home":
            return .home
        case "friends":
            return .friends
        case "log-reason":
            return .logReason
        default:
            return nil
        }
    }
}
