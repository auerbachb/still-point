import Foundation
import StillPointShared

enum LogReasonDeepLinkParser {
    static func date(from url: URL) -> String {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return WidgetDataStore.localDayString(Date())
        }

        let scheme = (components.scheme ?? "").lowercased()
        let host = (components.host ?? "").lowercased()
        guard scheme == "stillpoint", host == "log-reason" else {
            return WidgetDataStore.localDayString(Date())
        }

        if let rawDate = components.queryItems?.first(where: { $0.name == "date" })?.value?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !rawDate.isEmpty,
           SessionCalendar.isValidSessionCalendarDate(rawDate) {
            return rawDate
        }

        return WidgetDataStore.localDayString(Date())
    }
}
