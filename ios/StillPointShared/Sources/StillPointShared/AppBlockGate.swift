import Foundation

/// Pure daily-reset rule for the app-lock gate (#348 / #423).
///
/// An unlock earned on a given local day expires once the calendar advances to a
/// later day. Kept in the shared package (Foundation only — no DeviceActivity /
/// Family Controls imports) so the day-boundary contract is unit-testable on every
/// platform, and reused by both the simulator and device `AppBlockingManager`
/// branches so the two cannot drift.
public enum AppBlockGate {
    /// `true` when the gated apps should be (re-)locked: either there is no
    /// stored unlock, or the stored unlock is not from the same local day as `now`.
    ///
    /// - Parameters:
    ///   - date: the date a qualifying session was completed, or `nil`.
    ///   - now: the reference "now" (injectable for tests).
    ///   - calendar: the calendar defining the local day boundary (injectable for tests).
    public static func isUnlockExpired(
        unlockedFor date: Date?,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Bool {
        guard let date else { return true }
        return !calendar.isDate(date, inSameDayAs: now)
    }
}
