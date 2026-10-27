import Foundation

/// #769 / #896: today's two sits done as one. A dual-track sitter runs Track
/// One's and Track Two's sits back to back as one long sit. It is saved as one
/// standard row on the primary track with `combined: true` (#890) and counts for
/// both tracks (`tracksCredited`).
///
/// Mirrors `src/lib/combinedSit.ts` and `tracksCredited` in
/// `src/lib/sessionCalendar.ts`. The constants are mirrored, not shared: the
/// golden fixture `shared/test-fixtures/combinedSit.json` pins both apps, so they
/// cannot drift apart on what a combined sit is.
public enum CombinedSit {
    /// Planned length (seconds) of a combined sit: Track One's planned length
    /// plus Track Two's. Recovery is ignored on purpose. The sit is never offered
    /// while a recovery ramp is running (`isCombineOffered`), so there is no
    /// combined recovery length to define.
    public static func combinedDuration(currentDay: Int, secondTrackDay: Int) -> Int {
        StillPoint.duration(forDay: currentDay) + StillPoint.duration(forDay: secondTrackDay)
    }

    /// Whether today's two sits can be done as one: a dual-track account with
    /// neither track done today and no recovery ramp running.
    public static func isCombineOffered(
        dualTrackEnabled: Bool,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        recoveryActive: Bool
    ) -> Bool {
        dualTrackEnabled && !primaryDoneToday && !secondDoneToday && !recoveryActive
    }

    /// Which tracks one sit counts for.
    public struct TracksCredited: Equatable, Sendable {
        public var primary: Bool
        public var second: Bool

        public init(primary: Bool, second: Bool) {
            self.primary = primary
            self.second = second
        }
    }

    /// A combined row credits both tracks, whatever its `track`. Any other row
    /// credits its own track, and a missing track means primary (a row from
    /// before the dual-track fork).
    public static func tracksCredited(track: Track?, combined: Bool?) -> TracksCredited {
        if combined == true { return TracksCredited(primary: true, second: true) }
        let second = track == .second
        return TracksCredited(primary: !second, second: second)
    }

    /// `tracksCredited` for a fetched session row.
    public static func tracksCredited(_ session: SessionDTO) -> TracksCredited {
        tracksCredited(track: session.track, combined: session.combined)
    }

    /// The completion screen's "tomorrow" preview after a combined sit: what the
    /// next two sits add up to. A completed sit moves both tracks on a day; one
    /// ended early moves neither, so the preview is today's combined length
    /// again. `currentDay` and `secondTrackDay` are the counters before this sit
    /// was saved.
    public static func previewNextCombinedDuration(
        completed: Bool,
        currentDay: Int,
        secondTrackDay: Int
    ) -> Int {
        completed
            ? combinedDuration(currentDay: currentDay + 1, secondTrackDay: secondTrackDay + 1)
            : combinedDuration(currentDay: currentDay, secondTrackDay: secondTrackDay)
    }
}
