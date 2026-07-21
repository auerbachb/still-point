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
    /// True when any counted practice (standard, quick, or breath) was completed on `iso`.
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
    /// True when any counted practice (standard primary, quick, or breath) was
    /// completed today. Drives widget streak + weekday row. Legacy snapshots
    /// without this field decode using `primaryDoneToday` (#589).
    public var practiceDoneToday: Bool
    public var streak: Int
    /// #84 follow-up: ISO local-day strings (`yyyy-MM-dd`) within the trailing
    /// 7-day window on which counted practice was completed. Drives the
    /// Duolingo-style weekday checkmark row. Decoded permissively so snapshots
    /// written before this field shipped (build 15) still load.
    public var completedDates: [String]
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
        self.lastUpdated = lastUpdated
    }

    private enum CodingKeys: String, CodingKey {
        case isLoggedIn, userId, currentDay, secondTrackDay, dualTrackEnabled
        case recoveryTargetDay, recoveryCurrentStep, recoveryTotalSteps
        case primaryDoneToday, secondDoneToday, practiceDoneToday, streak, completedDates, lastUpdated
    }

    /// Custom decoder so blobs persisted before `completedDates` existed still
    /// load (the synthesized decoder would throw on the missing key).
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

    /// Whether the user has finished today's primary standard sit.
    public func isPrimaryCompleteForToday(at now: Date = Date()) -> Bool {
        primaryDoneToday && WidgetDataStore.isSameLocalDay(lastUpdated, now)
    }

    /// Whether the user has logged any counted practice today (standard primary,
    /// quick, or breath).
    public func isPracticeCompleteForToday(at now: Date = Date()) -> Bool {
        practiceDoneToday && WidgetDataStore.isSameLocalDay(lastUpdated, now)
    }

    /// Trailing 7-day window (oldest → newest, ending on the caller's local
    /// "today") of weekday marks for the Duolingo-style row. `now`'s column is
    /// checked when either `completedDates` records it or counted practice is
    /// already complete today.
    public func weekMarks(now: Date = Date(), calendar: Calendar = .current) -> [WidgetDayMark] {
        let completed = Set(completedDates)
        let start = calendar.startOfDay(for: now)
        let letters = WidgetData.narrowWeekdaySymbols(calendar: calendar)
        let names = WidgetData.fullWeekdaySymbols(calendar: calendar)
        return (0..<7).reversed().compactMap { offset -> WidgetDayMark? in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: start) else { return nil }
            let iso = WidgetDataStore.localDayString(date, calendar: calendar)
            let isToday = offset == 0
            let done = completed.contains(iso) || (isToday && isPracticeCompleteForToday(at: now))
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

    /// Widget gallery / Xcode preview fixture.
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
    /// `completedPracticeDates`, when supplied (from a real `getSessions()` fetch),
    /// becomes the authoritative 7-day completion set. When omitted, the prior
    /// snapshot's dates are carried forward so the fast, network-free sync path
    /// never wipes history it can't recompute. Today is always folded in when
    /// counted practice is done, so completing a sit checks today's box immediately.
    public static func makeSnapshot(
        user: UserDTO?,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        practiceDoneToday: Bool,
        now: Date = Date(),
        previous: WidgetData? = nil,
        completedPracticeDates: Set<String>? = nil
    ) -> WidgetData {
        guard let user else {
            return .loggedOut
        }

        let prior = previous ?? load()
        let streak = resolvedStreak(
            userId: user.id,
            practiceDoneToday: practiceDoneToday,
            previous: prior,
            now: now
        )

        let window = Set(localDayStrings(lastN: 7, endingAt: now))
        var dates: Set<String>
        if let completedPracticeDates {
            dates = completedPracticeDates.intersection(window)
        } else if let prior, prior.isLoggedIn, prior.userId == user.id {
            // Carry forward what we already knew; drop the other account's history.
            dates = Set(prior.completedDates).intersection(window)
        } else {
            dates = []
        }
        // Fold today in only on the synchronous fast path (no session set), where
        // `practiceDoneToday` is always same-day fresh. The authoritative path
        // already carries today's real completion in `completedPracticeDates`, so
        // trusting a possibly-stale flag there could wrongly check a new day if the
        // async fetch crossed local midnight.
        if completedPracticeDates == nil, practiceDoneToday {
            dates.insert(localDayString(now))
        }

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
            lastUpdated: now
        )
    }

    /// Whether a completed session counts toward widget streak / weekday marks.
    public static func sessionCountsForWidgetPractice(_ session: SessionDTO) -> Bool {
        guard session.completed else { return false }
        switch session.sessionType {
        case .quick, .breath:
            return true
        case .standard:
            return (session.track ?? .primary) == .primary
        }
    }

    /// The set of local days in the trailing 7-day window on which counted
    /// practice was recorded: primary standard sits, quick sits, and breath sits.
    /// Pure and network-free so it's unit-testable; the caller supplies sessions.
    public static func recentCompletedPracticeDates(
        from sessions: [SessionDTO],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Set<String> {
        let window = Set(localDayStrings(lastN: 7, endingAt: now, calendar: calendar))
        var result = Set<String>()
        for session in sessions where sessionCountsForWidgetPractice(session) {
            if window.contains(session.sessionDate) {
                result.insert(session.sessionDate)
            }
        }
        return result
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
        if data.practiceDoneToday {
            copy.streak = max(data.streak, 0)
        } else {
            copy.streak = 0
        }
        // Keep completion history bounded to the window the row can render.
        let window = Set(localDayStrings(lastN: 7, endingAt: now))
        copy.completedDates = data.completedDates.filter { window.contains($0) }
        return copy
    }

    /// Increment streak once per local day when counted practice flips to done.
    /// Preserves the last known streak across launches; resets on account switch.
    public static func resolvedStreak(
        userId: String,
        practiceDoneToday: Bool,
        previous: WidgetData?,
        now: Date = Date()
    ) -> Int {
        guard let previous, previous.isLoggedIn, previous.userId == userId else {
            return practiceDoneToday ? 1 : 0
        }

        if practiceDoneToday && !previous.practiceDoneToday {
            return max(previous.streak, 0) + 1
        }

        if practiceDoneToday && !isSameLocalDay(previous.lastUpdated, now) {
            // New local day and today is already complete (e.g. cold start after sync).
            return max(previous.streak, 0) + 1
        }

        if !practiceDoneToday && !isSameLocalDay(previous.lastUpdated, now) {
            // New day before today's sit: keep streak when yesterday was completed.
            if previous.practiceDoneToday {
                return max(previous.streak, 0)
            }
            return 0
        }

        return max(previous.streak, 0)
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
}
