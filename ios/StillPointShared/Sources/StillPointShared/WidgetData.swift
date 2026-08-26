import Foundation

/// App Group identifier shared with the main app, monitor extension, and widget.
public enum WidgetAppGroup {
    public static let id = "group.com.brettonauerbach.stillpoint"
    public static let dataKey = "widget.habitData.v1"
}

/// One column in the widget's Duolingo-style weekday row: a single-letter
/// weekday label plus whether any counted practice was completed that day.
public struct WidgetDayMark: Sendable, Equatable, Identifiable {
    /// ISO local-day string (`yyyy-MM-dd`) this column represents.
    public let iso: String
    /// Narrow weekday initial (e.g. `M`, `T`, `W`) for the caller's locale.
    public let letter: String
    /// Full weekday name (e.g. `Monday`) for the VoiceOver label.
    public let weekdayName: String
    /// True when the sit this row represents was completed on `iso`.
    public let done: Bool
    /// True for the trailing column (the caller's local "today").
    public let isToday: Bool

    public var id: String { iso }

    public init(iso: String, letter: String, weekdayName: String, done: Bool, isToday: Bool) {
        self.iso = iso
        self.letter = letter
        self.weekdayName = weekdayName
        self.done = done
        self.isToday = isToday
    }
}

/// Lightweight snapshot the home-screen widget reads from shared `UserDefaults`.
public struct WidgetData: Codable, Sendable, Equatable {
    public var isLoggedIn: Bool
    public var userId: String?
    public var currentDay: Int
    public var secondTrackDay: Int
    public var dualTrackEnabled: Bool
    /// #238: miss-a-day recovery ramp for the primary track timer readout.
    public var recoveryTargetDay: Int?
    public var recoveryCurrentStep: Int?
    public var recoveryTotalSteps: Int?
    public var primaryDoneToday: Bool
    public var secondDoneToday: Bool
    /// True when any counted **Track One** practice (primary standard, quick, or
    /// breath) was completed today. Drives the Track One weekday row. Legacy
    /// snapshots without this field decode using `primaryDoneToday` (#589).
    ///
    /// Track Two's equivalent is `secondDoneToday`; day continuity uses the union
    /// of both (see `isDayKeptToday(at:)`).
    public var practiceDoneToday: Bool
    public var streak: Int
    /// #84 follow-up: ISO local-day strings (`yyyy-MM-dd`) within the trailing
    /// 7-day window on which **Track One** practice was completed. Drives the
    /// Duolingo-style weekday checkmark row. Decoded permissively so snapshots
    /// written before this field shipped (build 15) still load.
    public var completedDates: [String]
    /// #684: the same trailing 7-day window for **Track Two** (second-track
    /// standard sits), rendered as its own row when `dualTrackEnabled` is true.
    ///
    /// Deliberately **not** back-filled: days practised before the user switched
    /// to a two-a-day schedule carry no second-track sit, so they render on the
    /// Track One row only. Legacy snapshots decode this as empty.
    public var secondCompletedDates: [String]
    public var lastUpdated: Date

    public init(
        isLoggedIn: Bool,
        userId: String?,
        currentDay: Int,
        secondTrackDay: Int,
        dualTrackEnabled: Bool,
        recoveryTargetDay: Int? = nil,
        recoveryCurrentStep: Int? = nil,
        recoveryTotalSteps: Int? = nil,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        practiceDoneToday: Bool = false,
        streak: Int,
        completedDates: [String] = [],
        secondCompletedDates: [String] = [],
        lastUpdated: Date
    ) {
        self.isLoggedIn = isLoggedIn
        self.userId = userId
        self.currentDay = currentDay
        self.secondTrackDay = secondTrackDay
        self.dualTrackEnabled = dualTrackEnabled
        self.recoveryTargetDay = recoveryTargetDay
        self.recoveryCurrentStep = recoveryCurrentStep
        self.recoveryTotalSteps = recoveryTotalSteps
        self.primaryDoneToday = primaryDoneToday
        self.secondDoneToday = secondDoneToday
        self.practiceDoneToday = practiceDoneToday
        self.streak = streak
        self.completedDates = completedDates
        self.secondCompletedDates = secondCompletedDates
        self.lastUpdated = lastUpdated
    }

    private enum CodingKeys: String, CodingKey {
        case isLoggedIn, userId, currentDay, secondTrackDay, dualTrackEnabled
        case recoveryTargetDay, recoveryCurrentStep, recoveryTotalSteps
        case primaryDoneToday, secondDoneToday, practiceDoneToday, streak
        case completedDates, secondCompletedDates, lastUpdated
    }

    /// Custom decoder so blobs persisted before `completedDates` /
    /// `secondCompletedDates` existed still load (the synthesized decoder would
    /// throw on the missing key).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        isLoggedIn = try c.decode(Bool.self, forKey: .isLoggedIn)
        userId = try c.decodeIfPresent(String.self, forKey: .userId)
        currentDay = try c.decode(Int.self, forKey: .currentDay)
        secondTrackDay = try c.decode(Int.self, forKey: .secondTrackDay)
        dualTrackEnabled = try c.decode(Bool.self, forKey: .dualTrackEnabled)
        recoveryTargetDay = try c.decodeIfPresent(Int.self, forKey: .recoveryTargetDay)
        recoveryCurrentStep = try c.decodeIfPresent(Int.self, forKey: .recoveryCurrentStep)
        recoveryTotalSteps = try c.decodeIfPresent(Int.self, forKey: .recoveryTotalSteps)
        primaryDoneToday = try c.decode(Bool.self, forKey: .primaryDoneToday)
        secondDoneToday = try c.decode(Bool.self, forKey: .secondDoneToday)
        practiceDoneToday = try c.decodeIfPresent(Bool.self, forKey: .practiceDoneToday)
            ?? primaryDoneToday
        streak = try c.decode(Int.self, forKey: .streak)
        completedDates = try c.decodeIfPresent([String].self, forKey: .completedDates) ?? []
        // Pre-#684 snapshots have no Track Two history: their `completedDates`
        // stay Track One and Track Two starts empty (no back-fill, no migration).
        secondCompletedDates = try c.decodeIfPresent([String].self, forKey: .secondCompletedDates) ?? []
        lastUpdated = try c.decode(Date.self, forKey: .lastUpdated)
    }

    public static let loggedOut = WidgetData(
        isLoggedIn: false,
        userId: nil,
        currentDay: 1,
        secondTrackDay: 1,
        dualTrackEnabled: false,
        primaryDoneToday: false,
        secondDoneToday: false,
        practiceDoneToday: false,
        streak: 0,
        completedDates: [],
        secondCompletedDates: [],
        lastUpdated: .distantPast
    )

    /// Primary-track duration in seconds for the widget readout.
    public var primaryDurationSeconds: Int {
        DurationRecovery.sessionDurationForUser(
            sessionType: .standard,
            currentDay: max(currentDay, 1),
            recovery: DurationRecovery.RecoveryFields(
                recoveryTargetDay: recoveryTargetDay,
                recoveryCurrentStep: recoveryCurrentStep,
                recoveryTotalSteps: recoveryTotalSteps
            )
        )
    }

    /// Local days in the trailing window on which **either** track recorded a
    /// completed sit — the set day continuity and the streak walk over (#684).
    public var completedDayUnion: Set<String> {
        Set(completedDates).union(secondCompletedDates)
    }

    /// Flag-only "at least one track finished a sit" for the day this snapshot
    /// was written. Freshness-checked variants: `isDayKeptToday(at:)`.
    public var anyTrackDoneToday: Bool {
        practiceDoneToday || secondDoneToday
    }

    /// Whether the user has finished today's primary standard sit.
    public func isPrimaryCompleteForToday(at now: Date = Date()) -> Bool {
        primaryDoneToday && WidgetDataStore.isSameLocalDay(lastUpdated, now)
    }

    /// Whether the user has finished today's second-track standard sit (#684).
    public func isSecondCompleteForToday(at now: Date = Date()) -> Bool {
        secondDoneToday && WidgetDataStore.isSameLocalDay(lastUpdated, now)
    }

    /// Whether the user has logged any counted Track One practice today
    /// (primary standard, quick, or breath).
    public func isPracticeCompleteForToday(at now: Date = Date()) -> Bool {
        practiceDoneToday && WidgetDataStore.isSameLocalDay(lastUpdated, now)
    }

    /// **Day-credit rule (#684; cross-surface policy tracked in #679):** a local
    /// day is *kept* when **at least one** track recorded a completed sit that
    /// day. On a two-a-day schedule, finishing either session preserves
    /// continuity; only a day with zero sits breaks the streak. A partial day
    /// counts exactly like a full day — one day is one unit.
    public func isDayKeptToday(at now: Date = Date()) -> Bool {
        isPracticeCompleteForToday(at: now) || isSecondCompleteForToday(at: now)
    }

    /// Trailing 7-day window (oldest → newest, ending on the caller's local
    /// "today") of weekday marks for the single-row (single-track) layout. A day
    /// is checked when **either** track completed a sit, matching the day-credit
    /// rule in `isDayKeptToday(at:)`. Single-track users have no Track Two
    /// history, so this is identical to their Track One row.
    public func weekMarks(now: Date = Date(), calendar: Calendar = .current) -> [WidgetDayMark] {
        weekMarks(
            completed: completedDayUnion,
            doneToday: isDayKeptToday(at: now),
            now: now,
            calendar: calendar
        )
    }

    /// Trailing 7-day window of weekday marks for one track's own row (#684).
    /// Each row reflects only its own track's completions, so the two rows show
    /// which individual session was hit and which was missed.
    public func weekMarks(
        for track: Track,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [WidgetDayMark] {
        switch track {
        case .primary:
            return weekMarks(
                completed: Set(completedDates),
                doneToday: isPracticeCompleteForToday(at: now),
                now: now,
                calendar: calendar
            )
        case .second:
            return weekMarks(
                completed: Set(secondCompletedDates),
                doneToday: isSecondCompleteForToday(at: now),
                now: now,
                calendar: calendar
            )
        }
    }

    /// Shared row builder: `doneToday` is the fallback for today's column when
    /// the snapshot's date set hasn't been rewritten yet (fast sync path).
    private func weekMarks(
        completed: Set<String>,
        doneToday: Bool,
        now: Date,
        calendar: Calendar
    ) -> [WidgetDayMark] {
        let start = calendar.startOfDay(for: now)
        let letters = WidgetData.narrowWeekdaySymbols(calendar: calendar)
        let names = WidgetData.fullWeekdaySymbols(calendar: calendar)
        return (0..<7).reversed().compactMap { offset -> WidgetDayMark? in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: start) else { return nil }
            let iso = WidgetDataStore.localDayString(date, calendar: calendar)
            let isToday = offset == 0
            let done = completed.contains(iso) || (isToday && doneToday)
            let weekday = calendar.component(.weekday, from: date)
            let letter = letters.isEmpty ? "" : letters[(weekday - 1) % letters.count]
            let name = names.isEmpty ? "" : names[(weekday - 1) % names.count]
            return WidgetDayMark(iso: iso, letter: letter, weekdayName: name, done: done, isToday: isToday)
        }
    }

    /// Narrow standalone weekday initials indexed by `weekday - 1` (1 = Sunday).
    static func narrowWeekdaySymbols(calendar: Calendar) -> [String] {
        let df = DateFormatter()
        df.calendar = calendar
        df.locale = calendar.locale ?? Locale(identifier: "en_US")
        let symbols: [String]? = df.veryShortStandaloneWeekdaySymbols
        return symbols ?? ["S", "M", "T", "W", "T", "F", "S"]
    }

    /// Full standalone weekday names indexed by `weekday - 1` (1 = Sunday).
    static func fullWeekdaySymbols(calendar: Calendar) -> [String] {
        let df = DateFormatter()
        df.calendar = calendar
        df.locale = calendar.locale ?? Locale(identifier: "en_US")
        let symbols: [String]? = df.standaloneWeekdaySymbols
        return symbols ?? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    }

    /// Widget gallery / Xcode preview fixture (single-track).
    ///
    /// Left single-track on purpose: `secondCompletedDates` is only meaningful
    /// when `dualTrackEnabled` is true, and seeding it here would double-check
    /// the single row through the day-credit union. The two-row preview lives in
    /// `previewDualTrack`.
    public static let preview = WidgetData(
        isLoggedIn: true,
        userId: "preview",
        currentDay: 24,
        secondTrackDay: 8,
        dualTrackEnabled: false,
        primaryDoneToday: false,
        secondDoneToday: false,
        practiceDoneToday: false,
        streak: 12,
        completedDates: WidgetDataStore.previewCompletedDates(),
        secondCompletedDates: [],
        lastUpdated: Date()
    )

    /// #684: two-a-day gallery / Xcode preview fixture — Track Two has a shorter
    /// history than Track One, the way a mid-week switch actually looks.
    public static let previewDualTrack = WidgetData(
        isLoggedIn: true,
        userId: "preview-dual",
        currentDay: 24,
        secondTrackDay: 8,
        dualTrackEnabled: true,
        primaryDoneToday: false,
        secondDoneToday: false,
        practiceDoneToday: false,
        streak: 12,
        completedDates: WidgetDataStore.previewCompletedDates(),
        secondCompletedDates: WidgetDataStore.previewSecondCompletedDates(),
        lastUpdated: Date()
    )
}

public enum WidgetDataStore {
    public static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: WidgetAppGroup.id)
    }

    public static func load() -> WidgetData? {
        guard let defaults = sharedDefaults,
              let data = defaults.data(forKey: WidgetAppGroup.dataKey) else {
            return nil
        }
        return try? JSONDecoder().decode(WidgetData.self, from: data)
    }

    @discardableResult
    public static func save(_ snapshot: WidgetData) -> Bool {
        guard let data = try? JSONEncoder().encode(snapshot),
              let defaults = sharedDefaults else {
            return false
        }
        defaults.set(data, forKey: WidgetAppGroup.dataKey)
        return true
    }

    public static func clear() {
        sharedDefaults?.removeObject(forKey: WidgetAppGroup.dataKey)
    }

    /// Build a widget snapshot from in-memory app state, adjusting streak without
    /// extra network calls by comparing against the last persisted snapshot.
    ///
    /// `completedPracticeDates` / `secondCompletedPracticeDates`, when supplied
    /// (from a real `getSessions()` fetch), become the authoritative 7-day
    /// completion sets for Track One and Track Two respectively. When omitted,
    /// the prior snapshot's dates are carried forward so the fast, network-free
    /// sync path never wipes history it can't recompute. Today is folded into a
    /// track only when that track's own "done today" flag is set, so completing
    /// either sit checks that row's box immediately (#684).
    public static func makeSnapshot(
        user: UserDTO?,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        practiceDoneToday: Bool,
        now: Date = Date(),
        previous: WidgetData? = nil,
        completedPracticeDates: Set<String>? = nil,
        secondCompletedPracticeDates: Set<String>? = nil
    ) -> WidgetData {
        guard let user else {
            return .loggedOut
        }

        let prior = previous ?? load()
        // Carry forward what we already knew; drop the other account's history.
        let sameAccount: Bool = {
            guard let prior, prior.isLoggedIn else { return false }
            return prior.userId == user.id
        }()

        let window = Set(localDayStrings(lastN: 7, endingAt: now))
        var dates = windowedDates(
            authoritative: completedPracticeDates,
            carriedForward: sameAccount ? prior?.completedDates : nil,
            window: window
        )
        var secondDates = windowedDates(
            authoritative: secondCompletedPracticeDates,
            carriedForward: sameAccount ? prior?.secondCompletedDates : nil,
            window: window
        )
        // Fold today in only on the synchronous fast path (no session set), where
        // the "done today" flags are always same-day fresh. The authoritative path
        // already carries today's real completion in the supplied set, so trusting
        // a possibly-stale flag there could wrongly check a new day if the async
        // fetch crossed local midnight.
        let today = localDayString(now)
        if completedPracticeDates == nil, practiceDoneToday {
            dates.insert(today)
        }
        if secondCompletedPracticeDates == nil, secondDoneToday {
            secondDates.insert(today)
        }

        // Day-credit rule (#684; cross-surface policy tracked in #679): the day is
        // kept when AT LEAST ONE track finished a sit. On a two-a-day schedule
        // either session alone preserves continuity — only a zero-sit day breaks it.
        let dayKeptToday = practiceDoneToday || secondDoneToday
        let streak = resolvedStreak(
            userId: user.id,
            dayKeptToday: dayKeptToday,
            previous: prior,
            now: now,
            completedDays: dates.union(secondDates)
        )

        return WidgetData(
            isLoggedIn: true,
            userId: user.id,
            currentDay: StillPoint.clampedCurrentDay(for: user),
            secondTrackDay: max(user.secondTrackDay, 1),
            dualTrackEnabled: user.dualTrackEnabled,
            recoveryTargetDay: user.recoveryTargetDay,
            recoveryCurrentStep: user.recoveryCurrentStep,
            recoveryTotalSteps: user.recoveryTotalSteps,
            primaryDoneToday: primaryDoneToday,
            secondDoneToday: secondDoneToday,
            practiceDoneToday: practiceDoneToday,
            streak: streak,
            completedDates: dates.sorted(),
            secondCompletedDates: secondDates.sorted(),
            lastUpdated: now
        )
    }

    /// Authoritative set when supplied, else the carried-forward one, always
    /// clipped to the trailing window the row can render.
    private static func windowedDates(
        authoritative: Set<String>?,
        carriedForward: [String]?,
        window: Set<String>
    ) -> Set<String> {
        if let authoritative {
            return authoritative.intersection(window)
        }
        if let carriedForward {
            return Set(carriedForward).intersection(window)
        }
        return []
    }

    /// Whether a completed session counts toward the given track's widget row.
    ///
    /// Track One counts primary standard sits plus quick and breath sits (#589);
    /// Track Two counts second-track standard sits (#684). A session with no
    /// `track` predates the dual-track fork and is treated as primary.
    public static func sessionCountsForWidgetPractice(_ session: SessionDTO, track: Track) -> Bool {
        guard session.completed else { return false }
        switch track {
        case .primary:
            switch session.sessionType {
            case .quick, .breath:
                return true
            case .standard:
                return (session.track ?? .primary) == .primary
            }
        case .second:
            guard session.sessionType == .standard else { return false }
            return session.track == .second
        }
    }

    /// Track One convenience overload, preserving the pre-#684 call shape.
    public static func sessionCountsForWidgetPractice(_ session: SessionDTO) -> Bool {
        sessionCountsForWidgetPractice(session, track: .primary)
    }

    /// The local days in the trailing 7-day window on which each track recorded
    /// counted practice — Track One (primary standard, quick, breath) and Track
    /// Two (second-track standard). Pure and network-free so it's unit-testable;
    /// the caller supplies sessions. The window is the same for both rows; only
    /// the completion source is split by track (#684).
    public static func recentCompletedPracticeDates(
        from sessions: [SessionDTO],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> (primary: Set<String>, second: Set<String>) {
        let window = Set(localDayStrings(lastN: 7, endingAt: now, calendar: calendar))
        var primary = Set<String>()
        var second = Set<String>()
        for session in sessions where window.contains(session.sessionDate) {
            if sessionCountsForWidgetPractice(session, track: .primary) {
                primary.insert(session.sessionDate)
            }
            if sessionCountsForWidgetPractice(session, track: .second) {
                second.insert(session.sessionDate)
            }
        }
        return (primary: primary, second: second)
    }

    /// Normalize persisted data for widget display, clearing stale "done today"
    /// flags and re-resolving streak after local midnight without an app sync.
    public static func normalizedForDisplay(_ data: WidgetData, now: Date = Date()) -> WidgetData {
        guard data.isLoggedIn else { return data }
        guard !isSameLocalDay(data.lastUpdated, now) else { return data }

        var copy = data
        copy.primaryDoneToday = false
        copy.secondDoneToday = false
        copy.practiceDoneToday = false
        // Keep completion history bounded to the window the rows can render.
        let window = Set(localDayStrings(lastN: 7, endingAt: now))
        copy.completedDates = data.completedDates.filter { window.contains($0) }
        copy.secondCompletedDates = data.secondCompletedDates.filter { window.contains($0) }
        if let userId = data.userId {
            // Re-resolve under the same day-credit rule the app uses, so a widget
            // left untouched across several days drops a genuinely broken streak.
            copy.streak = resolvedStreak(
                userId: userId,
                dayKeptToday: false,
                previous: data,
                now: now,
                completedDays: Set(copy.completedDates).union(copy.secondCompletedDates)
            )
        } else {
            copy.streak = data.anyTrackDoneToday ? max(data.streak, 0) : 0
        }
        return copy
    }

    /// Resolve the widget streak under the #684 day-credit rule: a local day
    /// counts when **at least one** track completed a sit that day.
    ///
    /// Two independent estimates are combined:
    ///
    /// 1. A backward walk over `completedDays` (the union of both tracks) from
    ///    today — or yesterday when today is still open. This is real evidence,
    ///    and it is what catches a multi-day gap the carried-forward value used
    ///    to paper over. It is only a **lower** bound, because the set is pruned
    ///    to the trailing 7-day window the rows render.
    /// 2. The carried-forward streak from the previous snapshot, which knows
    ///    about history older than that window.
    ///
    /// The larger wins: the walk can only *raise* a stale carried value, and a
    /// real gap zeroes both.
    public static func resolvedStreak(
        userId: String,
        dayKeptToday: Bool,
        previous: WidgetData?,
        now: Date = Date(),
        completedDays: Set<String> = [],
        calendar: Calendar = .current
    ) -> Int {
        let today = localDayString(now, calendar: calendar)
        var days = completedDays
        if dayKeptToday {
            days.insert(today)
        }
        let walked = consecutiveKeptDays(endingAt: today, in: days)
        let carried = carriedStreak(
            userId: userId,
            dayKeptToday: dayKeptToday,
            previous: previous,
            now: now,
            calendar: calendar
        )
        return max(walked, carried)
    }

    /// Consecutive kept days ending at `today`, or at yesterday when today has no
    /// sit yet (today is still open, so it can't break the streak). Modeled on
    /// `SessionStatistics.calculateStats`'s backward walk.
    private static func consecutiveKeptDays(endingAt today: String, in days: Set<String>) -> Int {
        var cursor: String
        if days.contains(today) {
            cursor = today
        } else {
            let yesterday = SessionCalendar.addDays(toIsoDate: today, deltaDays: -1)
            guard yesterday != today, days.contains(yesterday) else { return 0 }
            cursor = yesterday
        }

        var count = 0
        while days.contains(cursor) {
            count += 1
            let previousDay = SessionCalendar.addDays(toIsoDate: cursor, deltaDays: -1)
            if previousDay == cursor { break }
            cursor = previousDay
        }
        return count
    }

    /// Carry the previous snapshot's streak forward across local days, so a
    /// streak longer than the 7-day history window survives. Resets on account
    /// switch, and on any gap of two or more days with no recorded sit.
    private static func carriedStreak(
        userId: String,
        dayKeptToday: Bool,
        previous: WidgetData?,
        now: Date,
        calendar: Calendar
    ) -> Int {
        guard let previous, previous.isLoggedIn, previous.userId == userId else {
            return dayKeptToday ? 1 : 0
        }

        let priorStreak = max(previous.streak, 0)
        let priorDayKept = previous.anyTrackDoneToday
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

    public static func isSameLocalDay(_ lhs: Date, _ rhs: Date) -> Bool {
        Calendar.current.isDate(lhs, inSameDayAs: rhs)
    }

    /// Local-day `yyyy-MM-dd` for `date`, matching exactly how the app stamps
    /// `sessionDate` (`SessionViewModel.saveSession`): POSIX locale + an explicit
    /// **Gregorian** calendar, in the caller's timezone. Forcing Gregorian (rather
    /// than `Calendar.current`) keeps the digits aligned on devices whose preferred
    /// calendar is non-Gregorian (e.g. Buddhist/Japanese), so string equality with
    /// `sessionDate` still holds and real completions aren't dropped from the row.
    public static func localDayString(_ date: Date, calendar: Calendar = .current) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.calendar = Calendar(identifier: .gregorian)
        df.timeZone = calendar.timeZone
        df.dateFormat = "yyyy-MM-dd"
        return df.string(from: date)
    }

    /// The last `n` local-day strings, oldest → newest, ending on `now`'s day.
    public static func localDayStrings(lastN n: Int, endingAt now: Date = Date(), calendar: Calendar = .current) -> [String] {
        guard n > 0 else { return [] }
        let start = calendar.startOfDay(for: now)
        return (0..<n).reversed().compactMap { offset in
            calendar.date(byAdding: .day, value: -offset, to: start)
                .map { localDayString($0, calendar: calendar) }
        }
    }

    /// Four of the six prior days marked complete, for gallery/Xcode previews.
    public static func previewCompletedDates(now: Date = Date()) -> [String] {
        let recent = localDayStrings(lastN: 7, endingAt: now)
        return Array(recent.dropLast().suffix(4))
    }

    /// Two of the four prior days marked complete on Track Two, so the dual-track
    /// preview shows a shorter second-track history than Track One (#684).
    public static func previewSecondCompletedDates(now: Date = Date()) -> [String] {
        Array(previewCompletedDates(now: now).suffix(2))
    }
}
