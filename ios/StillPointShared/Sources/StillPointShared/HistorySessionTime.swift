import Foundation

/// Minimal session fields for history time totals (matches web `HistorySessionTimeInput`).
public protocol HistorySessionTimeInput {
    var sessionDate: String { get }
    var duration: Int { get }
    var actualTime: Int? { get }
}

extension SessionDTO: HistorySessionTimeInput {}

public enum HistorySessionTime {
    /// Seconds counted toward history time totals (elapsed wall time for the sit).
    public static func sessionTimeSeconds(_ session: some HistorySessionTimeInput) -> Int {
        max(0, session.actualTime ?? session.duration)
    }
}
