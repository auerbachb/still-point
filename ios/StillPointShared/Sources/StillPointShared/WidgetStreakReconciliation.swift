import Foundation

// How the widget derives its streak (#671, #679, #684).
//
// The streak is never accumulated from flag transitions. It is the run of kept
// days the weekday rows themselves show, extended past the oldest column only by
// the server anchor or the previous snapshot's carried value, and only while the
// rows show an unbroken run back to that column. `makeSnapshot`,
// `normalizedForDisplay`, and `merged(late:onto:now:)` all resolve their streak
// through this file.

extension WidgetData {
    /// #671: the run of consecutive kept days the weekday row *itself* shows,
    /// ending on today — or on yesterday when today is still pending. Read
    /// straight off `weekMarks(now:)` so it is, by construction, the number a
    /// person counts off the row with their finger. On a two-a-day schedule that
    /// row is the union of the two rendered rows, matching the day-credit rule.
    /// Bounded by the 7-day window; `streak` may legitimately exceed it (see
    /// `serverStreak`), but can never fall below it.
    public func weekRowStreak(now: Date = Date(), calendar: Calendar = .current) -> Int {
        WidgetData.rowRun(in: weekMarks(now: now, calendar: calendar))
    }

    /// True when `weekRowStreak` runs off the oldest column of the row, i.e. the
    /// row cannot see where the streak actually began. Only then may a larger
    /// `streak` be shown without contradicting the row.
    public func weekRowStreakReachesWindowEdge(now: Date = Date(), calendar: Calendar = .current) -> Bool {
        let marks = weekMarks(now: now, calendar: calendar)
        let run = WidgetData.rowRun(in: marks)
        guard run > 0 else { return false }
        let pendingToday = marks.last.map { !$0.done } ?? false
        return run + (pendingToday ? 1 : 0) >= marks.count
    }

    /// Walk the rendered marks newest → oldest, counting completed days until a
    /// missed one. A pending *today* is skipped rather than treated as a break.
    private static func rowRun(in marks: [WidgetDayMark]) -> Int {
        var run = 0
        for mark in marks.reversed() {
            if mark.done {
                run += 1
            } else if mark.isToday {
                continue
            } else {
                break
            }
        }
        return run
    }
}

extension WidgetDataStore {
    /// The run of consecutive kept days ending today — or ending yesterday when
    /// today is still pending — implied by `completedDates`. This is the same run
    /// the weekday row draws, so the two can never disagree (#671).
    public static func historyStreak(
        completedDates: [String],
        practiceDoneToday: Bool = false,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Int {
        historyRun(
            days: windowDays(now: now, calendar: calendar),
            completedDates: completedDates,
            practiceDoneToday: practiceDoneToday
        ).length
    }

    /// The streak the widget displays: the run its own row shows, extended past
    /// the oldest column by history the row cannot see — and only when the row
    /// corroborates an unbroken run all the way back to that column.
    ///
    /// Two extension sources, both bounded by that same guard:
    ///
    /// 1. `serverStreak` anchored on `serverStreakDate` (#671) — the
    ///    server-computed `stats.streak`, anchored onto a day inside the
    ///    corroborated run so later days extend it without a second fetch. Those
    ///    later days are counted from `standardDates`, never from the row, so the
    ///    days extending the total are exactly the days that produced it (#679).
    /// 2. `carriedStreak` (#684) — the previous snapshot's own value, which knows
    ///    about days older than the window when no anchor has been stored yet.
    ///
    /// Recomputing locally keeps the number correct offline and after a day
    /// rollover; both extensions are reconciliation inputs, never overrides. A
    /// visible gap in the row therefore always wins: `/api/sessions` reports the
    /// run ending at the *latest recorded* day, which stays non-zero long after a
    /// streak has actually lapsed, and a carried value knows nothing about the
    /// days it skipped.
    public static func reconciledStreak(
        completedDates: [String],
        standardDates: [String] = [],
        practiceDoneToday: Bool = false,
        serverStreak: Int?,
        serverStreakDate: String?,
        carriedStreak: Int? = nil,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Int {
        let days = windowDays(now: now, calendar: calendar)
        let run = historyRun(
            days: days,
            completedDates: completedDates,
            practiceDoneToday: practiceDoneToday
        )
        guard run.length > 0 else { return 0 }
        // The row itself shows where the streak broke — nothing may extend it.
        guard run.startOffset + run.length >= days.count else { return run.length }

        var extended = run.length
        var anchoredTotal: Int?
        if let serverStreak, serverStreak > 0, let serverStreakDate,
           let anchorOffset = days.firstIndex(of: serverStreakDate),
           anchorOffset >= run.startOffset,
           anchorOffset < run.startOffset + run.length {
            // **Standard-only policy at the call site (#679).** `serverStreak` is
            // web's `calculateSessionStats` total, which counts completed standard
            // sits and ignores track. The row this anchor sits inside counts quick
            // and breath sits too, and splits standard sits by track, so the days
            // it shows are *not* the days that produced this number. Extending by
            // them let a quick-only day push the widget past what the app and web
            // display for the same account.
            //
            // So the extension term walks `standardDates` — the same population
            // `sessionCountsForServerStreak(_:)` selected — newest-ward from the
            // anchor, and stops at the first day without a standard sit: a gap
            // ends the server's own run, and no day beyond it may be claimed. The
            // result is therefore always a total the server itself once reported,
            // and never larger than the old `anchorOffset - run.startOffset`.
            let daysSinceAnchor = standardDaysAfterAnchor(
                days: days,
                standardDays: Set(standardDates),
                anchorOffset: anchorOffset,
                runStartOffset: run.startOffset
            )
            anchoredTotal = serverStreak + daysSinceAnchor
        }
        if let anchoredTotal {
            // #679: the carried value is deliberately *not* consulted here. It is
            // the previous snapshot's own number incremented by the #684 day-credit
            // rule — one per kept day, quick and breath sits included — so applying
            // it on top of a standard-only total launders a practice day back into
            // the number the anchor path just refused. That is not hypothetical: a
            // morning backfill followed by a quick sit at noon is the ordinary
            // sequence, and it would re-inflate the streak the same afternoon.
            //
            // Nothing is lost by skipping it. The carried value exists for the case
            // this branch does not cover — days older than the window when no
            // anchor has been stored yet (#684) — and an admitted anchor is
            // strictly better evidence for the same span: a server-computed total
            // for the days before it, plus the standard days since. The `else`
            // below still carries it whenever no anchor applies.
            extended = max(extended, anchoredTotal)
        } else if let carriedStreak, carriedStreak > 0 {
            extended = max(extended, carriedStreak)
        }
        return extended
    }

    /// How many consecutive days carrying a completed standard sit lie between
    /// the server anchor and the newest day of the corroborated run — walked
    /// newest-ward from the anchor (`anchorOffset - 1` down to `runStartOffset`)
    /// and stopped at the first day without one (#679).
    ///
    /// Stopping rather than skipping is what keeps the result honest: the server
    /// counts a *consecutive* run of standard days, so a day without one ends the
    /// run the anchor belongs to. Counting past it would report a total the server
    /// never held. Returns 0 when the anchor is already the newest day of the run,
    /// which is the pre-#679 behaviour for that case.
    ///
    /// Callers must have checked `runStartOffset <= anchorOffset < days.count`, as
    /// `reconciledStreak` does — `runStartOffset` is 0 or 1, so the walk cannot
    /// step below index 0.
    private static func standardDaysAfterAnchor(
        days: [String],
        standardDays: Set<String>,
        anchorOffset: Int,
        runStartOffset: Int
    ) -> Int {
        var count = 0
        var offset = anchorOffset - 1
        while offset >= runStartOffset, standardDays.contains(days[offset]) {
            count += 1
            offset -= 1
        }
        return count
    }

    /// Resolve the widget streak under the #684 day-credit rule — a local day
    /// counts when **at least one** track completed a sit that day — subject to
    /// the #671 invariant that the number may never contradict the rendered rows.
    ///
    /// `completedDays` is the union of both tracks' history: exactly what
    /// `WidgetData.weekMarks(now:)` renders. `standardDays` is the separate,
    /// unrendered standard-only set that alone may extend `serverStreak` (#679).
    /// The previous snapshot's streak is
    /// offered as an extension candidate only; `reconciledStreak` admits it just
    /// when the run reaches the oldest column, i.e. when the rows cannot see
    /// where the streak began.
    public static func resolvedStreak(
        userId: String,
        dayKeptToday: Bool,
        previous: WidgetData?,
        now: Date = Date(),
        completedDays: Set<String> = [],
        standardDays: Set<String> = [],
        serverStreak: Int? = nil,
        serverStreakDate: String? = nil,
        calendar: Calendar = .current
    ) -> Int {
        // Another account's history and streak must never carry over.
        let sameAccount = previous.flatMap { snapshot in
            snapshot.isLoggedIn && snapshot.userId == userId ? snapshot : nil
        }
        return reconciledStreak(
            completedDates: Array(completedDays),
            standardDates: Array(standardDays),
            practiceDoneToday: dayKeptToday,
            serverStreak: serverStreak,
            serverStreakDate: serverStreakDate,
            carriedStreak: carriedStreak(
                dayKeptToday: dayKeptToday,
                previous: sameAccount,
                now: now,
                calendar: calendar
            ),
            now: now,
            calendar: calendar
        )
    }

    /// Carry the previous snapshot's streak forward across local days, so a
    /// streak longer than the 7-day history window survives (#684). Resets on any
    /// gap of two or more days with no recorded sit. Callers must have already
    /// confirmed the snapshot belongs to the same account.
    ///
    /// This is a *candidate*, not the answer: `reconciledStreak` discards it the
    /// moment the rendered row shows where the run actually broke (#671).
    private static func carriedStreak(
        dayKeptToday: Bool,
        previous: WidgetData?,
        now: Date,
        calendar: Calendar
    ) -> Int {
        guard let previous, previous.isLoggedIn else {
            return dayKeptToday ? 1 : 0
        }

        let priorStreak = max(previous.streak, 0)
        // Was the previous snapshot's *own* local day already counted? The flags
        // alone are not enough: the authoritative fetch path records the day in
        // history while leaving a track's flag false, and reading only the flag
        // there would count that day a second time on the next display.
        let priorDay = localDayString(previous.lastUpdated, calendar: calendar)
        let priorDayKept = previous.anyTrackDoneToday || previous.completedDayUnion.contains(priorDay)
        let elapsed = SessionCalendar.daysBetweenInclusive(
            fromIso: localDayString(previous.lastUpdated, calendar: calendar),
            toIso: localDayString(now, calendar: calendar)
        )

        if elapsed <= 0 {
            // Same local day (or a backwards clock): count the day once, when it
            // first flips to kept.
            return dayKeptToday && !priorDayKept ? priorStreak + 1 : priorStreak
        }

        // #684: two or more days without a recorded sit break the streak. The old
        // carry-forward preserved it no matter how long the app had been closed.
        guard elapsed == 1, priorDayKept else {
            return dayKeptToday ? 1 : 0
        }
        return dayKeptToday ? priorStreak + 1 : priorStreak
    }

    /// Offsets are counted back from today: `startOffset` 0 means the run ends
    /// today, 1 means it ends yesterday (today still pending).
    private struct HistoryRun {
        let length: Int
        let startOffset: Int
    }

    /// The renderable window newest → oldest, so an array index *is* the day's
    /// offset back from today.
    private static func windowDays(now: Date, calendar: Calendar) -> [String] {
        Array(localDayStrings(lastN: historyWindowDays, endingAt: now, calendar: calendar).reversed())
    }

    private static func historyRun(
        days: [String],
        completedDates: [String],
        practiceDoneToday: Bool
    ) -> HistoryRun {
        guard let today = days.first else { return HistoryRun(length: 0, startOffset: 0) }
        var completed = Set(completedDates)
        if practiceDoneToday { completed.insert(today) }

        let startOffset = completed.contains(today) ? 0 : 1
        var length = 0
        var offset = startOffset
        while offset < days.count, completed.contains(days[offset]) {
            length += 1
            offset += 1
        }
        return HistoryRun(length: length, startOffset: startOffset)
    }
}
