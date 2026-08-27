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
    /// Streak the widget renders. Always derived from the completion history the
    /// rows are drawn from (`completedDates` ∪ `secondCompletedDates`, plus the
    /// extensions below) by `WidgetDataStore.reconciledStreak` — never
    /// accumulated from snapshot-to-snapshot flag transitions (#671), so it can
    /// never contradict the weekday row(s) rendered beside it.
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
    /// #671: server-computed `stats.streak` from `/api/sessions`, the only source
    /// that knows about days older than the trailing-7 window the rows render.
    /// Used solely to *extend* a run the rows already corroborate — never to
    /// contradict them. Nil when no authoritative fetch has landed yet.
    public var serverStreak: Int?
    /// #671: the ISO local day `serverStreak` counts through (the most recent
    /// completed standard sit at fetch time). Anchors the server total onto the
    /// row so later days can extend it without a second fetch.
    public var serverStreakDate: String?
    public var lastUpdated: Date
    /// True only for a blob persisted *before* #671 shipped: one whose
    /// `completedDates` and `serverStreak` keys are both absent, so it records a
    /// `streak` with no evidence behind it. Distinguishes **unknown** history
    /// ("this writer never stored any") from **known-empty** history ("this
    /// writer stored history and it is empty" — a genuine lapse). Both decode to
    /// `completedDates == []`, so `isEmpty` alone cannot tell them apart, and
    /// conflating them either zeroes every upgrading user's streak or lets a
    /// real lapse keep a stale one.
    ///
    /// Provenance, not content: set only by `init(from:)`, absent from
    /// `CodingKeys` so it is never written back, and always `false` for a
    /// snapshot this version constructs — including every `makeSnapshot` result.
    /// A legacy blob therefore self-heals to `false` the first time the app
    /// writes real history.
    public private(set) var historyIsUnknown: Bool = false

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
        serverStreak: Int? = nil,
        serverStreakDate: String? = nil,
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
        self.serverStreak = serverStreak
        self.serverStreakDate = serverStreakDate
        self.lastUpdated = lastUpdated
    }

    private enum CodingKeys: String, CodingKey {
        case isLoggedIn, userId, currentDay, secondTrackDay, dualTrackEnabled
        case recoveryTargetDay, recoveryCurrentStep, recoveryTotalSteps
        case primaryDoneToday, secondDoneToday, practiceDoneToday, streak
        case completedDates, secondCompletedDates
        case serverStreak, serverStreakDate, lastUpdated
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
        serverStreak = try c.decodeIfPresent(Int.self, forKey: .serverStreak)
        serverStreakDate = try c.decodeIfPresent(String.self, forKey: .serverStreakDate)
        lastUpdated = try c.decode(Date.self, forKey: .lastUpdated)
        // Key *absence* — not an empty value — is what marks a pre-#671 writer.
        // `contains` is the only signal that survives `decodeIfPresent`'s
        // `?? []`, so it is captured here rather than inferred later. Any history
        // key at all, either track's, means the writer recorded history: a #684
        // snapshot always writes both, so it is never mistaken for a legacy blob.
        historyIsUnknown = !c.contains(.completedDates)
            && !c.contains(.secondCompletedDates)
            && !c.contains(.serverStreak)
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
    /// completed sit — the set day continuity and the streak walk over (#684),
    /// and therefore the evidence the displayed streak must agree with (#671).
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
    ///
    /// #671 reads the streak off exactly this row: on a two-a-day schedule the
    /// two rendered rows show, between them, precisely the days this union row
    /// marks, so "the run the row draws" is well-defined for both layouts.
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
        return (0..<WidgetDataStore.historyWindowDays).reversed().compactMap { offset -> WidgetDayMark? in
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

    /// Whether the weekday row's trailing column (today) renders as completed.
    /// Mirrors exactly what `weekMarks(now:)` decides — the union of both tracks
    /// under the #684 day-credit rule — so streak derivation and the rendered
    /// row(s) can never disagree about today (#671).
    public func isTodayMarkedDone(now: Date = Date(), calendar: Calendar = .current) -> Bool {
        completedDayUnion.contains(WidgetDataStore.localDayString(now, calendar: calendar))
            || isDayKeptToday(at: now)
    }

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
        // Anchored on yesterday so the 12 stays compatible with the 6-day row.
        serverStreak: 12,
        serverStreakDate: WidgetDataStore.previewCompletedDates().last,
        lastUpdated: Date()
    )

    /// #684: two-a-day gallery / Xcode preview fixture — Track Two has a shorter
    /// history than Track One, the way a mid-week switch actually looks. The
    /// union of the two rows is still the unbroken run `streak` claims (#671).
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
        serverStreak: 12,
        serverStreakDate: WidgetDataStore.previewCompletedDates().last,
        lastUpdated: Date()
    )
}

public enum WidgetDataStore {
    /// Length of the trailing history window the widget keeps and renders.
    public static let historyWindowDays = 7

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

    /// Why the app is about to render a signed-out widget snapshot.
    public enum SignedOutCause: Sendable, Equatable {
        /// The user signed out, or the server authoritatively reported no session.
        case signedOut
        /// Credentials were rejected (HTTP 401) — the session is genuinely over.
        case unauthorized
        /// The server answered, but with an error that says nothing about auth.
        case serverError
        /// The server could not be reached at all (offline cold start).
        case unreachable
    }

    /// #671 (symptom 2 — "the week resets"): only an authoritative sign-out may
    /// wipe the shared snapshot. A launch that simply can't reach the server is
    /// not a sign-out, and clearing there destroys the widget's only copy of the
    /// week: the rows go blank, and once history is refetched the streak has
    /// already restarted from 1 because there is no longer a prior snapshot to
    /// build on. Keeping the blob costs nothing — `normalizedForDisplay` bounds
    /// and re-derives it on every read.
    public static func shouldClearStoredSnapshot(on cause: SignedOutCause) -> Bool {
        switch cause {
        case .signedOut, .unauthorized:
            return true
        case .serverError, .unreachable:
            return false
        }
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
    ///
    /// #671: the streak is then *derived* from the union of those sets — the
    /// same evidence the rows draw — rather than accumulated from flag
    /// transitions, so a day the app never observed can no longer be silently
    /// dropped. It is extended past the window edge only by the server anchor or
    /// the previous snapshot's carried value, and only while the rows corroborate
    /// an unbroken run all the way back to that edge.
    public static func makeSnapshot(
        user: UserDTO?,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        practiceDoneToday: Bool,
        now: Date = Date(),
        previous: WidgetData? = nil,
        completedPracticeDates: Set<String>? = nil,
        secondCompletedPracticeDates: Set<String>? = nil,
        serverStreak: Int? = nil,
        serverStreakDate: String? = nil
    ) -> WidgetData {
        guard let user else {
            return .loggedOut
        }

        // Nil unless the stored snapshot belongs to this same signed-in account —
        // another account's history and streak must never carry over.
        let prior = (previous ?? load()).flatMap { snapshot in
            snapshot.isLoggedIn && snapshot.userId == user.id ? snapshot : nil
        }

        let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: now))
        var dates = windowedDates(
            authoritative: completedPracticeDates,
            carriedForward: prior?.completedDates,
            window: window
        )
        var secondDates = windowedDates(
            authoritative: secondCompletedPracticeDates,
            carriedForward: prior?.secondCompletedDates,
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

        // The authoritative fetch supplies a fresh (streak, anchor) pair; the fast,
        // network-free path reuses the one already stored for this same account so
        // a sit today still extends a streak older than the 7-day rows.
        let resolvedServerStreak: Int?
        let resolvedServerStreakDate: String?
        if serverStreak != nil || serverStreakDate != nil {
            resolvedServerStreak = serverStreak
            resolvedServerStreakDate = serverStreakDate
        } else if let prior {
            resolvedServerStreak = prior.serverStreak
            resolvedServerStreakDate = prior.serverStreakDate
        } else {
            resolvedServerStreak = nil
            resolvedServerStreakDate = nil
        }

        // Day-credit rule (#684; cross-surface policy tracked in #679): the day is
        // kept when AT LEAST ONE track finished a sit. On a two-a-day schedule
        // either session alone preserves continuity — only a zero-sit day breaks
        // it. This matches exactly what `weekMarks(now:)` renders for today.
        let union = dates.union(secondDates)
        let dayKeptToday = union.contains(today) || practiceDoneToday || secondDoneToday
        let streak = resolvedStreak(
            userId: user.id,
            dayKeptToday: dayKeptToday,
            previous: prior,
            now: now,
            completedDays: union,
            serverStreak: resolvedServerStreak,
            serverStreakDate: resolvedServerStreakDate
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
            serverStreak: resolvedServerStreak,
            serverStreakDate: resolvedServerStreakDate,
            lastUpdated: now
        )
    }

    /// Authoritative set when supplied, else the carried-forward one, always
    /// clipped to the trailing window the rows can render.
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
        let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: now, calendar: calendar))
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

    /// Normalize persisted data for widget display: clear stale "done today"
    /// flags after local midnight, prune both tracks' history to the renderable
    /// window, and re-derive the streak from that history.
    ///
    /// #671: the streak is recomputed on *every* display (not only on a day
    /// rollover) so the number beside the rows is always the number they imply.
    /// The old rollover branch zeroed the streak whenever the previous snapshot's
    /// `practiceDoneToday` was false, wiping an intact streak the history plainly
    /// showed.
    public static func normalizedForDisplay(_ data: WidgetData, now: Date = Date()) -> WidgetData {
        guard data.isLoggedIn else { return data }

        var copy = data
        if !isSameLocalDay(data.lastUpdated, now) {
            copy.primaryDoneToday = false
            copy.secondDoneToday = false
            copy.practiceDoneToday = false
            // Keep completion history bounded to the window the rows can render.
            let window = Set(localDayStrings(lastN: historyWindowDays, endingAt: now))
            copy.completedDates = data.completedDates.filter { window.contains($0) }
            copy.secondCompletedDates = data.secondCompletedDates.filter { window.contains($0) }
        }
        // A snapshot written before #671 carries a historical `streak` but no
        // stored evidence for it: its `completedDates` and `serverStreak` keys
        // are both absent, so they decode to `[]` and `nil`. Recomputing from
        // that reads 0 -- not because the streak lapsed, but because the
        // evidence was never recorded -- which would zero every existing user's
        // widget the moment they upgraded, before the app next foregrounded.
        // The widget is exactly the surface that renders *without* the app
        // opening, so that is a visible regression in a change whose whole
        // purpose is to stop the streak being wrong.
        //
        // The distinction has to come from `historyIsUnknown`, which records
        // whether those keys were *present* at decode time. An `isEmpty` test
        // cannot make it: a snapshot written by this version also prunes to an
        // empty history once the user lapses past the window, and treating that
        // as "unknown" would keep a stale streak beside a blank row -- bug #671
        // itself. Provenance separates them; emptiness does not.
        //
        // Belt and braces: even for a legacy blob, skip recomputation only while
        // there is genuinely nothing to recompute from. Any evidence at all,
        // from either track or from the anchor, goes down the normal path.
        let historyIsUnrecorded = copy.historyIsUnknown
            && copy.completedDayUnion.isEmpty
            && copy.serverStreak == nil
        guard !historyIsUnrecorded else { return copy }

        // The snapshot is its own "previous": its stored streak is the only record
        // of days older than the window until the next authoritative fetch. A nil
        // `userId` fails the same-account check inside `resolvedStreak`, so an
        // unattributed blob carries nothing forward.
        copy.streak = resolvedStreak(
            userId: data.userId ?? "",
            dayKeptToday: copy.isTodayMarkedDone(now: now),
            previous: data,
            now: now,
            completedDays: copy.completedDayUnion,
            serverStreak: copy.serverStreak,
            serverStreakDate: copy.serverStreakDate
        )
        return copy
    }

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
    ///    corroborated run so later days extend it without a second fetch.
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
        if let serverStreak, serverStreak > 0, let serverStreakDate,
           let anchorOffset = days.firstIndex(of: serverStreakDate),
           anchorOffset >= run.startOffset,
           anchorOffset < run.startOffset + run.length {
            // Days completed since the server counted, all inside the corroborated run.
            let daysSinceAnchor = anchorOffset - run.startOffset
            extended = max(extended, serverStreak + daysSinceAnchor)
        }
        if let carriedStreak, carriedStreak > 0 {
            extended = max(extended, carriedStreak)
        }
        return extended
    }

    /// Resolve the widget streak under the #684 day-credit rule — a local day
    /// counts when **at least one** track completed a sit that day — subject to
    /// the #671 invariant that the number may never contradict the rendered rows.
    ///
    /// `completedDays` is the union of both tracks' history: exactly what
    /// `WidgetData.weekMarks(now:)` renders. The previous snapshot's streak is
    /// offered as an extension candidate only; `reconciledStreak` admits it just
    /// when the run reaches the oldest column, i.e. when the rows cannot see
    /// where the streak began.
    public static func resolvedStreak(
        userId: String,
        dayKeptToday: Bool,
        previous: WidgetData?,
        now: Date = Date(),
        completedDays: Set<String> = [],
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

    /// The local day the server-computed `stats.streak` counts through: the most
    /// recent completed **standard** sit, matching the web's `calculateSessionStats`
    /// (which counts standard sessions only). Nil when there is no such sit.
    ///
    /// Deliberately track-agnostic: under the #684 day-credit rule a second-track
    /// standard sit keeps its day and is drawn on the Track Two row, so an anchor
    /// landing there is corroborated by the rendered rows. The remaining
    /// cross-surface gap — the server counts standard sits only, while the rows
    /// also count quick and breath — is tracked in #679.
    public static func serverStreakAnchorDate(from sessions: [SessionDTO]) -> String? {
        var latest: String?
        for session in sessions where session.completed && session.sessionType == .standard {
            if let current = latest, session.sessionDate <= current { continue }
            latest = session.sessionDate
        }
        return latest
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

    /// The six prior days marked complete, for gallery/Xcode previews. An
    /// unbroken trailing run so the preview streak can't contradict the row.
    public static func previewCompletedDates(now: Date = Date()) -> [String] {
        Array(localDayStrings(lastN: historyWindowDays, endingAt: now).dropLast())
    }

    /// The two most recent of those days on Track Two, so the dual-track preview
    /// shows a shorter second-track history than Track One (#684) while the union
    /// of the two rows stays the unbroken run the preview streak claims.
    public static func previewSecondCompletedDates(now: Date = Date()) -> [String] {
        Array(previewCompletedDates(now: now).suffix(2))
    }
}
