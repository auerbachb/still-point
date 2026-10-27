import Foundation
import StillPointShared

/// Which practice day it is: the done-today flags' reset and midnight rollover, and the
/// credited day a sit is stored on (the 6:00 grace window keeps an unfinished day open).
///
/// The flags and the grace-window state live in `practiceDay`, a `PracticeDayState`
/// declared in `AppViewModel.swift`. Its rules are in StillPointShared (#894). The
/// server reads that feed it — the per-track refresh and the yesterday lookup — are in
/// `AppViewModel+TracksDoneRefresh.swift`.
extension AppViewModel {
    func resetTrackCompletionBadges() {
        practiceDay.reset()
    }

    /// Practice day a new sit is stored on, and the `?date=` sent to `/api/auth/me`.
    func creditedSessionDate(now: Date = Date()) -> String {
        practiceDay.creditedSessionDate(now: now, dualTrack: dualTrackEnabled)
    }

    /// Instant `makeSnapshot` should treat as "now" so flags fold into the credited day.
    /// The rule is shared with the background refresh (`WidgetDataStore.practiceInstant`).
    func creditedPracticeInstant(now: Date = Date()) -> Date {
        practiceDay.creditedPracticeInstant(now: now, dualTrack: dualTrackEnabled)
    }

    /// Retire the "done today" flags when the local day has advanced past the one
    /// they describe, and re-stamp them onto the current day. Called before the
    /// flags are written and before they are read; see
    /// `PracticeDayState.rollOverIfNeeded(now:dualTrack:calendar:)` for why.
    func rollOverDoneTodayFlagsIfNeeded(now: Date = Date()) {
        practiceDay.rollOverIfNeeded(now: now, dualTrack: dualTrackEnabled)
    }
}
