import Foundation

/// Which practice day it is and what has been sat on it, as the foreground app knows
/// it: the five "done today" flags, the day they describe, and what is known about
/// whether the previous calendar day is finished, which keeps that day open until
/// 6:00 (#797).
///
/// `AppViewModel` holds one and runs the network reads around it.
/// `refreshTracksDoneToday()` asks the server about yesterday through
/// ``beginPreviousDayRead(now:calendar:)`` and the two `apply` methods, then about the
/// credited day through the badge query, which lands through
/// ``applyTracksDoneAnswer(_:creditedDate:now:calendar:)`` or
/// ``applyFailedTracksDoneRead(now:dualTrack:calendar:)``. A finished sit lands through
/// ``recordCompletion(sessionType:track:now:dualTrack:calendar:)``. The rules live
/// here, not on the view model, so the shared tests can hold that read open across a
/// sit's end (#894), and fail the badge query (#970).
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
    /// An instant on the practice day the five flags above were last rolled onto —
    /// i.e. the local day they are a statement *about*: the day a sit is credited
    /// to, which before 6:00 is the previous calendar day while that day is open
    /// (#969). They are all claims about that one day, and carrying one onto the
    /// next would claim a day that was never sat.
    /// ``rollOverIfNeeded(now:dualTrack:calendar:)`` uses it to retire the flags.
    /// The widget's fold has its own guard: `syncWidgetData()` passes
    /// `makeSnapshot` the credited practice instant as `flagsAsOf` (#797).
    public var doneTodayFlagsStamp: Date?
    /// #1071 (web parity with `tracksDoneTodayKnown`, #895): whether
    /// `primaryDoneToday` / `secondDoneToday` are the server's answer for the practice
    /// day they describe. False at a launch and after ``reset()``, from the moment a
    /// badge query leaves (``beginTracksDoneRead()``) until the newest one is applied,
    /// after a failed one (the badges then hold only the local flags, which cannot see
    /// a sit on another device), after a sit finishes here (the server answer predates
    /// it), and once the flags roll onto a new day. The badges read the flags either
    /// way; this is for anything offered only while a sit is due, such as the combine
    /// action, which must not act on "neither done" that is not an answer.
    public private(set) var doneTodayFlagsKnown = false
    /// Numbers the badge queries ``beginTracksDoneRead()`` opens, so only the newest
    /// one's answer makes the flags known; an older one landing while a newer query is
    /// in flight leaves them unknown, as web does.
    public private(set) var tracksDoneRead = 0
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
    /// #970: the yesterday lookup's answer, per track, and the calendar day it is
    /// about. Kept for crediting only: `requiredSitsCompleteFromFlags` counts it with
    /// the flags while they describe that day. The Home badges and the widget flags
    /// never read it, so a failed badge query shows only the local flags. A failed
    /// lookup keeps it, a newer answer replaces it, and ``reset()`` drops it.
    private var previousDayTracks: (day: String, tracks: TracksDoneTodayDTO)?

    public init() {}

    /// Back to a launch: nothing sat, nothing known about yesterday, and any
    /// yesterday lookup still in flight disowned.
    public mutating func reset() {
        clearDoneTodayFlags()
        previousCalendarDayComplete = true
        previousDayResolved = false
        resolvedForCalendarDay = nil
        previousDayRequest += 1
        previousDayTracks = nil
        doneTodayFlagsStamp = nil
        doneTodayFlagsKnown = false
        tracksDoneRead += 1
    }

    // MARK: - Tracks-done badge query

    /// A credited-day badge query is leaving (#1071). Until the answer it returns is
    /// applied, the flags are not an answer. Returns the read number to pass back to
    /// ``applyTracksDoneAnswer(_:creditedDate:now:read:calendar:)``.
    public mutating func beginTracksDoneRead() -> Int {
        tracksDoneRead += 1
        doneTodayFlagsKnown = false
        return tracksDoneRead
    }

    // MARK: - Credited practice day

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
        return creditedDayStamp(now: now, calendar: calendar)
    }

    // MARK: - Previous-day lookup

    /// The start of a lookup of whether yesterday is finished. Before 6:00 an
    /// unknown answer keeps it open.
    ///
    /// - Returns: the ticket to hand back with the answer, or `nil` when there is
    ///   nothing to ask: yesterday is already known to be finished, or it is 6:00 or
    ///   later, which finishes it.
    public mutating func beginPreviousDayRead(now: Date, calendar: Calendar = .current) -> Int? {
        if previousCalendarDayComplete && previousDayAnswerIsCurrent(now: now, calendar: calendar) {
            return nil
        }
        guard isBeforeGraceCutoff(now, calendar: calendar) else {
            resolvePreviousDayAsComplete(now: now, calendar: calendar)
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
        // #970: kept per track. Two-a-day reduces it to "finished or not" just
        // below, and that alone loses a server sit on one track when the other
        // track's sit finishes here afterwards.
        previousDayTracks = (SessionCalendar.localIsoDate(now: now, offsetDays: -1, calendar: calendar), tracks)
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
        if flagsDescribeYesterday(now: now, calendar: calendar) {
            previousCalendarDayComplete = requiredSitsCompleteFromFlags(dualTrack: dualTrack, now: now, calendar: calendar)
        } else {
            previousCalendarDayComplete = !isBeforeGraceCutoff(now, calendar: calendar)
        }
        // Unresolved so the next refresh retries the lookup.
        previousDayResolved = false
        resolvedForCalendarDay = nil
    }

    // MARK: - Tracks-done badge answers

    /// The credited-day badge query's answer: `getTracksDoneToday(date:)` for
    /// `creditedDate`, the day ``creditedSessionDate(now:dualTrack:calendar:)`` gave
    /// at `now`, when the query left. `refreshTracksDoneToday()` applies it only while
    /// it is the signed-in account's and the newest word on that day.
    ///
    /// `read` is the number ``beginTracksDoneRead()`` gave the query. The answer makes
    /// the flags known (#1071) only when it is the newest query's; `nil` (no ordering)
    /// always does.
    public mutating func applyTracksDoneAnswer(
        _ tracks: TracksDoneTodayDTO,
        creditedDate: String,
        now: Date,
        read: Int? = nil,
        calendar: Calendar = .current
    ) {
        // The flags have rolled past `creditedDate` while the query was out, e.g. it
        // left before 6:00 and a sit at 6:00 or later rolled them onto today. The
        // answer describes a day they no longer do: raising its flags would claim it
        // for today, and moving the stamp back to yesterday would let the next
        // rollover clear today's sit. Drop it; the next refresh asks about today.
        if let stamp = doneTodayFlagsStamp,
           SessionCalendar.localIsoDate(now: stamp, calendar: calendar) > creditedDate {
            return
        }
        primaryDoneToday = tracks.primary
        secondDoneToday = tracks.second
        if primaryDoneToday {
            practiceDoneToday = true
            // #679: the server confirming a primary standard sit today is the
            // same fact the local flag records, so raise it here too. Like its
            // siblings this only ever goes up — ``applyFailedTracksDoneRead(now:dualTrack:calendar:)``
            // reads the local flags into the badges, never lowers them.
            primaryStandardDoneToday = true
        }
        if secondDoneToday {
            secondPracticeDoneToday = true
        }
        if read == nil || read == tracksDoneRead {
            doneTodayFlagsKnown = true
        }
        // An answer about yesterday is a statement about yesterday, and so are the
        // flags it just raised.
        if creditedDate != SessionCalendar.localIsoDate(now: now, calendar: calendar) {
            let startToday = calendar.startOfDay(for: now)
            if let evening = calendar.date(byAdding: .hour, value: -1, to: startToday) {
                doneTodayFlagsStamp = evening
            }
        }
    }

    /// The credited-day badge query failed at `now`, at rest (mid-sit the app keeps
    /// the badges). The Home badges fall back to the sits this app run remembers for
    /// the practice day: the #679 local standard-sit flags, which hold sits this
    /// device finished (offline ones still queued for sync included) and the
    /// standard sits earlier badge answers reported (#1021). Web does the same from
    /// the sits its session remembers (`loadedSitsRef`, #961).
    ///
    /// Rolled over first, so a stale "done today" from a day the flags no longer
    /// describe never reaches the badges: on a new practice day the flags are
    /// cleared and the badges read "neither done", as they did before. Nothing else
    /// changes: a failed request is an absent answer, not the server contradicting
    /// the local flags, so they are only read here. The yesterday lookup's answer
    /// stays too, for crediting (#970), and the badges never read it.
    public mutating func applyFailedTracksDoneRead(now: Date, dualTrack: Bool, calendar: Calendar = .current) {
        rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
        primaryDoneToday = primaryStandardDoneToday
        secondDoneToday = secondPracticeDoneToday
        // #1071: local flags only, so a sit on another device may be missing.
        doneTodayFlagsKnown = false
    }

    // MARK: - Rollover and completion

    /// Retire the "done today" flags when the local day has advanced past the one
    /// they describe, and re-stamp them onto the day a sit is now credited to.
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
    /// over with the rest for the same reason: on a new day nothing has been sat
    /// yet, and the next successful refresh restores the truth. The refresh failure
    /// path rolls over first too, before it reads the local flags into the badges.
    public mutating func rollOverIfNeeded(now: Date, dualTrack: Bool, calendar: Calendar = .current) {
        if let stamp = doneTodayFlagsStamp, calendar.isDate(stamp, inSameDayAs: now) {
            return
        }
        let beforeCutoff = isBeforeGraceCutoff(now, calendar: calendar)
        if doneTodayFlagsStamp == nil {
            // Nothing claimed yet. Before 6:00 keep yesterday open until a fetch
            // says it is finished, unless that fetch already answered.
            if !previousDayAnswerIsCurrent(now: now, calendar: calendar) {
                previousCalendarDayComplete = !beforeCutoff
            }
            // #969: onto the day a sit is now credited to, which is yesterday while
            // it is open. Stamped with `now`, a launch before 6:00 put the flags on
            // today, so the branch below never weighed them against yesterday, and
            // a sit that finished it left it open until a badge query answered and
            // moved the stamp back.
            doneTodayFlagsStamp = creditedDayStamp(now: now, calendar: calendar)
            return
        }
        if beforeCutoff, flagsDescribeYesterday(now: now, calendar: calendar) {
            if requiredSitsCompleteFromFlags(dualTrack: dualTrack, now: now, calendar: calendar) {
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
                resolvePreviousDayAsComplete(now: now, calendar: calendar)
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
        // stamp is older than yesterday. Roll onto the practice day. A resolved
        // answer for *this* calendar day is kept. A stale one must not.
        if !previousDayAnswerIsCurrent(now: now, calendar: calendar) {
            previousCalendarDayComplete = true
            previousDayResolved = false
            resolvedForCalendarDay = nil
        }
        clearDoneTodayFlags()
        // #1071: the answer was about the day just retired; the new one has none yet.
        doneTodayFlagsKnown = false
        // The calendar day, unless a current answer keeps yesterday open after a
        // stamp older than yesterday. Then, as at a launch, yesterday (#969).
        doneTodayFlagsStamp = creditedDayStamp(now: now, calendar: calendar)
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
        // #832: which flags this sit raises is `PracticeCompletionFlags`' decision;
        // the mapping and its rationale live there. Only ever raised, never lowered.
        let raised = PracticeCompletionFlags.raised(sessionType: sessionType, track: track)
        // #839: a focus session is not meditation practice (#765). It raises none
        // of the flags below, so it leaves before the rollover too, and changes
        // nothing here. `markPracticeDoneToday` never sends one.
        if raised.isEmpty { return }
        // BEFORE the writes below, never after. This sit belongs to the current
        // local day; any flag still standing from yesterday does not. Rolling over
        // first retires those and re-stamps onto today, so the flag raised just
        // below survives the identical (now no-op) rollover inside
        // `syncWidgetData()`. Doing it afterwards would clear the very sit that
        // just finished.
        rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
        // #1071: the last answer predates this sit, which the badges do not show
        // until the next one lands.
        doneTodayFlagsKnown = false
        if raised.contains(.practice) {
            practiceDoneToday = true
        }
        if raised.contains(.secondPractice) {
            secondPracticeDoneToday = true
        }
        if raised.contains(.primaryStandard) {
            // #679: without this the flame stood still until `getTracksDoneToday`
            // caught up.
            primaryStandardDoneToday = true
        }
    }

    // MARK: - Private helpers

    /// Lowers the five "done today" flags. Their stamp and `doneTodayFlagsKnown`
    /// are the caller's to set, since a reset and a rollover set them differently.
    private mutating func clearDoneTodayFlags() {
        primaryDoneToday = false
        secondDoneToday = false
        practiceDoneToday = false
        secondPracticeDoneToday = false
        primaryStandardDoneToday = false
    }

    /// Whether `now` falls before 6:00, while the previous calendar day can still be open.
    private func isBeforeGraceCutoff(_ now: Date, calendar: Calendar) -> Bool {
        calendar.component(.hour, from: now) < SessionCalendar.graceCutoffHour
    }

    /// Whether the flags' stamp falls on the calendar day before `now`'s, i.e. the
    /// flags describe yesterday.
    private func flagsDescribeYesterday(now: Date, calendar: Calendar) -> Bool {
        guard let stamp = doneTodayFlagsStamp,
              let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now))
        else { return false }
        return calendar.isDate(stamp, inSameDayAs: yesterday)
    }

    /// Records yesterday as finished, and that answer as `now`'s calendar day's.
    private mutating func resolvePreviousDayAsComplete(now: Date, calendar: Calendar) {
        previousCalendarDayComplete = true
        previousDayResolved = true
        resolvedForCalendarDay = SessionCalendar.localIsoDate(now: now, calendar: calendar)
    }

    /// Single-track: the primary standard sit. Two-a-day: both standard sits.
    /// Weighed while the flags describe yesterday.
    private func requiredSitsCompleteFromFlags(dualTrack: Bool, now: Date, calendar: Calendar) -> Bool {
        // Local flags cover a sit that finished offline and has not reached the
        // server badges yet. Without them the day stays open and the next sit
        // before 6:00 is stored on yesterday again.
        //
        // #970: the yesterday lookup's answer covers the opposite case, a sit that
        // is on the server only (sat on another device, on the web, or in an
        // earlier app run) while the badge query that would report it has failed
        // or not answered. Without it, two-a-day lost that sit, and a sit here on
        // the other track could not close the day.
        let yesterday = SessionCalendar.localIsoDate(now: now, offsetDays: -1, calendar: calendar)
        let server = previousDayTracks?.day == yesterday ? previousDayTracks?.tracks : nil
        let primary = primaryDoneToday || primaryStandardDoneToday || server?.primary == true
        let second = secondDoneToday || secondPracticeDoneToday || server?.second == true
        return dualTrack ? (primary && second) : primary
    }

    private func previousDayAnswerIsCurrent(now: Date, calendar: Calendar) -> Bool {
        previousDayResolved && resolvedForCalendarDay == SessionCalendar.localIsoDate(now: now, calendar: calendar)
    }

    /// An instant on the day a sit at `now` is credited to: 23:00 on the previous
    /// calendar day before 6:00 while that day is open, else `now`. The rollover
    /// stamps the flags with it, so the stamp names the day they describe (#969).
    /// A badge answer about yesterday moves the stamp to the same instant
    /// (``applyTracksDoneAnswer(_:creditedDate:now:calendar:)``).
    private func creditedDayStamp(now: Date, calendar: Calendar) -> Date {
        WidgetDataStore.practiceInstant(
            previousDayComplete: previousCalendarDayComplete,
            now: now,
            calendar: calendar
        )
    }
}
