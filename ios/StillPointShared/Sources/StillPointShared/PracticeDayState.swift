import Foundation

/// Which practice day it is and what has been sat on it, as the foreground app knows
/// it: the five "done today" flags, the day they describe, and what is known about
/// whether the previous calendar day is finished, which keeps that day open until
/// 6:00 (#797).
///
/// `AppViewModel` holds one and runs the network reads around it.
/// `refreshTracksDoneToday()` asks the server about yesterday through
/// ``beginPreviousDayRead(now:calendar:)`` and the two `apply` methods, and a
/// finished sit lands through
/// ``recordCompletion(sessionType:track:now:dualTrack:calendar:)``. The rules live
/// here, not on the view model, so the shared tests can hold that read open across a
/// sit's end (#894).
///
/// The clock, the calendar and the dual-track setting are parameters, read at each
/// call, which is when the view model read them before.
///
/// Not thread-safe by itself: hold it on an actor or, as the app does, on a
/// `@MainActor` type.
public struct PracticeDayState: Sendable {
    /// #240: per-track "completed a standard sit today", drives the Home badges.
    public var primaryDoneToday = false
    public var secondDoneToday = false
    /// Any counted Track One practice today (standard primary, quick, or breath)
    /// for the widget. Deliberately separate from `primaryDoneToday`: the Home
    /// badges are server-derived, while this drives the widget's weekday row.
    public var practiceDoneToday = false
    /// #684: the Track Two equivalent — a second-track standard sit today. Feeds
    /// the widget's second weekday row without touching the Home badge above.
    public var secondPracticeDoneToday = false
    /// #679: a *primary* **standard** sit today, known locally. The Track One
    /// analogue of `secondPracticeDoneToday`, and narrower than
    /// `practiceDoneToday`, which quick and breath sits also raise. It exists
    /// because the widget's standard-only day set may only be extended by days the
    /// server would itself have counted, and `primaryDoneToday` — the server-derived
    /// Home badge — is still false in the moment a sit finishes, which delayed the
    /// streak until the next `getTracksDoneToday` round-trip.
    public var primaryStandardDoneToday = false
    /// The moment the five flags above were last rolled over — i.e. the local day
    /// they are a statement *about*. They are all same-day claims, and
    /// `WidgetDataStore.makeSnapshot` folds each of them into *today*; carrying
    /// one across local midnight would claim a day that was never sat. Passed to
    /// `makeSnapshot` as `flagsAsOf` so the fold is retired at the boundary, and
    /// used by ``rollOverIfNeeded(now:dualTrack:calendar:)`` to retire the flags
    /// themselves.
    public var doneTodayFlagsStamp: Date?
    /// Whether every required sit for the previous calendar day is done.
    /// False before 6:00 keeps that day open. Defaults to finished so a daytime
    /// launch does not invent a grace window; a pre-6:00 launch resolves it.
    public private(set) var previousCalendarDayComplete = true
    /// Set once yesterday has an answer, so a later rollover does not replace it with
    /// the pre-6:00 "unknown" default. The answer is the server's
    /// (``applyPreviousDayAnswer(_:ticket:now:dualTrack:calendar:)``), or the flags
    /// finishing yesterday themselves (#894).
    public private(set) var previousDayResolved = false
    /// Calendar day `previousDayResolved` describes. A new morning must ask again.
    public private(set) var resolvedForCalendarDay: String?
    /// Orders overlapping yesterday lookups so a slow answer cannot replace a newer one.
    /// The flags finishing yesterday take a ticket too (#894), so a lookup that was
    /// already in flight cannot replace that either.
    public private(set) var previousDayRequest = 0

    public init() {}

    /// Back to a launch: nothing sat, nothing known about yesterday, and any
    /// yesterday lookup still in flight disowned.
    public mutating func reset() {
        primaryDoneToday = false
        secondDoneToday = false
        practiceDoneToday = false
        secondPracticeDoneToday = false
        primaryStandardDoneToday = false
        previousCalendarDayComplete = true
        previousDayResolved = false
        resolvedForCalendarDay = nil
        previousDayRequest += 1
        doneTodayFlagsStamp = nil
    }

    /// Single-track: the primary standard sit. Two-a-day: both standard sits.
    private func requiredSitsCompleteFromFlags(dualTrack: Bool) -> Bool {
        // Local flags cover a sit that finished offline and has not reached the
        // server badges yet. Without them the day stays open and the next sit
        // before 6:00 is stored on yesterday again.
        let primary = primaryDoneToday || primaryStandardDoneToday
        let second = secondDoneToday || secondPracticeDoneToday
        return dualTrack ? (primary && second) : primary
    }

    private func previousDayAnswerIsCurrent(now: Date, calendar: Calendar) -> Bool {
        previousDayResolved && resolvedForCalendarDay == SessionCalendar.localIsoDate(now: now, calendar: calendar)
    }

    /// Practice day a new sit is stored on, and the `?date=` sent to `/api/auth/me`.
    public mutating func creditedSessionDate(now: Date, dualTrack: Bool, calendar: Calendar = .current) -> String {
        rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
        return SessionCalendar.effectiveLocalIsoDate(
            previousDayComplete: previousCalendarDayComplete,
            now: now,
            calendar: calendar
        )
    }

    /// Instant `makeSnapshot` should treat as "now" so flags fold into the credited day.
    /// The rule is shared with the background refresh (`WidgetDataStore.practiceInstant`).
    public mutating func creditedPracticeInstant(now: Date, dualTrack: Bool, calendar: Calendar = .current) -> Date {
        // The rollover `creditedSessionDate(now:)` runs, so the answer read below is current.
        rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
        return WidgetDataStore.practiceInstant(
            previousDayComplete: previousCalendarDayComplete,
            now: now,
            calendar: calendar
        )
    }

    /// The start of a lookup of whether yesterday is finished. Before 6:00 an
    /// unknown answer keeps it open.
    ///
    /// - Returns: the ticket to hand back with the answer, or `nil` when there is
    ///   nothing to ask: yesterday is already known to be finished, or it is 6:00 or
    ///   later, which finishes it.
    public mutating func beginPreviousDayRead(now: Date, calendar: Calendar = .current) -> Int? {
        let calendarDay = SessionCalendar.localIsoDate(now: now, calendar: calendar)
        if previousDayResolved && previousCalendarDayComplete && resolvedForCalendarDay == calendarDay {
            return nil
        }
        guard calendar.component(.hour, from: now) < SessionCalendar.graceCutoffHour else {
            previousCalendarDayComplete = true
            previousDayResolved = true
            resolvedForCalendarDay = calendarDay
            return nil
        }
        previousDayRequest += 1
        return previousDayRequest
    }

    /// The server's answer for yesterday, from the lookup that took `ticket` at `now`.
    /// Ignored when a newer lookup, or a reset, has taken a ticket since.
    public mutating func applyPreviousDayAnswer(
        _ tracks: TracksDoneTodayDTO,
        ticket: Int,
        now: Date,
        dualTrack: Bool,
        calendar: Calendar = .current
    ) {
        guard ticket == previousDayRequest else { return }
        previousCalendarDayComplete = dualTrack
            ? (tracks.primary && tracks.second)
            : tracks.primary
        previousDayResolved = true
        resolvedForCalendarDay = SessionCalendar.localIsoDate(now: now, calendar: calendar)
    }

    /// The lookup that took `ticket` at `now` failed. Ignored, like an answer, when a
    /// newer lookup or a reset has taken a ticket since.
    public mutating func applyFailedPreviousDayRead(
        ticket: Int,
        now: Date,
        dualTrack: Bool,
        calendar: Calendar = .current
    ) {
        guard ticket == previousDayRequest else { return }
        if let stamp = doneTodayFlagsStamp,
           let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now)),
           calendar.isDate(stamp, inSameDayAs: yesterday) {
            previousCalendarDayComplete = requiredSitsCompleteFromFlags(dualTrack: dualTrack)
        } else {
            previousCalendarDayComplete = calendar.component(.hour, from: now) >= SessionCalendar.graceCutoffHour
        }
        // Unresolved so the next refresh retries the lookup.
        previousDayResolved = false
        resolvedForCalendarDay = nil
    }

    /// Retire the "done today" flags when the local day has advanced past the one
    /// they describe, and re-stamp them onto the current day.
    ///
    /// The flags used to be cleared in exactly one place: the top of
    /// `refreshTracksDoneToday()`, which is a network round-trip. The path that
    /// actually crosses midnight with them raised is the one deliberately built to
    /// need no network — `markPracticeDoneToday` -> `syncWidgetData()`, called the
    /// instant a sit ends. A quick sit at 00:05, or a second-track sit, therefore
    /// reached the snapshot with yesterday's primary-standard flag still true and
    /// let it fold today into the standard-only set that extends `serverStreak`:
    /// the exact inflation #679 exists to remove.
    ///
    /// Called before the flags are written and before they are read, so no caller
    /// has to remember the rollover. The server-derived Home badges are rolled
    /// over with the rest for the same reason and on the same fail-closed logic
    /// the refresh failure path already uses: on a new day nothing has been sat
    /// yet, and the next successful refresh restores the truth.
    public mutating func rollOverIfNeeded(now: Date, dualTrack: Bool, calendar: Calendar = .current) {
        if let stamp = doneTodayFlagsStamp, calendar.isDate(stamp, inSameDayAs: now) {
            return
        }
        let hour = calendar.component(.hour, from: now)
        if doneTodayFlagsStamp == nil {
            // Nothing claimed yet. Before 6:00 keep yesterday open until a fetch
            // says it is finished, unless that fetch already answered.
            if !previousDayAnswerIsCurrent(now: now, calendar: calendar) {
                previousCalendarDayComplete = hour >= SessionCalendar.graceCutoffHour
            }
            doneTodayFlagsStamp = now
            return
        }
        if hour < SessionCalendar.graceCutoffHour,
           let stamp = doneTodayFlagsStamp,
           let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now)),
           calendar.isDate(stamp, inSameDayAs: yesterday) {
            if requiredSitsCompleteFromFlags(dualTrack: dualTrack) {
                // #894: the flags describe yesterday and hold every required sit, so
                // yesterday is finished, whatever the server last said about it. An
                // answer read before the sit ended cannot have seen it, whether that
                // answer landed before the sit ended or is still in flight, so its
                // "incomplete" is the server lagging, not contradicting. Kept as this
                // calendar day's answer, so `beginPreviousDayRead` asks nothing more
                // today, and the ticket moves as it does for a newer lookup, so one
                // still in flight changes nothing when it lands, answered or failed.
                // Web keeps a sit remembered across the same read
                // (`mergeRememberedSits`, PR #878).
                previousCalendarDayComplete = true
                previousDayResolved = true
                resolvedForCalendarDay = SessionCalendar.localIsoDate(now: now, calendar: calendar)
                previousDayRequest += 1
            } else if previousDayAnswerIsCurrent(now: now, calendar: calendar) {
                if !previousCalendarDayComplete {
                    return
                }
            } else {
                previousCalendarDayComplete = false
                return
            }
        }
        // The previous day is finished, the clock is at or after 6:00, or the
        // stamp is older than yesterday. Roll onto the calendar day. A resolved
        // answer for *this* calendar day is kept. A stale one must not.
        if !previousDayAnswerIsCurrent(now: now, calendar: calendar) {
            previousCalendarDayComplete = true
            previousDayResolved = false
            resolvedForCalendarDay = nil
        }
        primaryDoneToday = false
        secondDoneToday = false
        practiceDoneToday = false
        secondPracticeDoneToday = false
        primaryStandardDoneToday = false
        doneTodayFlagsStamp = now
    }

    /// A sit that finished at `now`, on its own track: the flags `markPracticeDoneToday`
    /// raises before it pushes a widget snapshot.
    public mutating func recordCompletion(
        sessionType: SessionType,
        track: Track,
        now: Date,
        dualTrack: Bool,
        calendar: Calendar = .current
    ) {
        // #839: a focus session is not meditation practice (#765). It raises none
        // of the flags below, so it leaves before the rollover too, and changes
        // nothing here. `markPracticeDoneToday` never sends one.
        if sessionType == .focus { return }
        // BEFORE the writes below, never after. This sit belongs to the current
        // local day; any flag still standing from yesterday does not. Rolling over
        // first retires those and re-stamps onto today, so the flag raised just
        // below survives the identical (now no-op) rollover inside
        // `syncWidgetData()`. Doing it afterwards would clear the very sit that
        // just finished.
        rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
        switch sessionType {
        case .quick, .breath:
            // Quick and breath sits are Track One practice whichever track the
            // user launched them from — they have no second-track counterpart.
            practiceDoneToday = true
        case .standard:
            if track == .second {
                secondPracticeDoneToday = true
            } else {
                practiceDoneToday = true
                // #679: and record it as a *standard* sit. `practiceDoneToday` alone
                // cannot say so — quick and breath sits raise it too — and the
                // standard-only day set that extends `serverStreak` may only take
                // days the server would have counted. Without this the flame stood
                // still until `getTracksDoneToday` caught up.
                primaryStandardDoneToday = true
            }
        case .focus:
            // Returned above, before the rollover.
            return
        }
    }
}
