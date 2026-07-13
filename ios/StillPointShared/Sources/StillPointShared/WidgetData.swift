import Foundation

/// App Group identifier shared with the main app, monitor extension, and widget.
public enum WidgetAppGroup {
    public static let id = "group.com.brettonauerbach.stillpoint"
    public static let dataKey = "widget.habitData.v1"
}

/// One column in the widget's Duolingo-style weekday row: a single-letter
/// weekday label plus whether the primary standard sit was completed that day.
public struct WidgetDayMark: Sendable, Equatable, Identifiable {
    /// ISO local-day string (`yyyy-MM-dd`) this column represents.
    public let iso: String
    /// Narrow weekday initial (e.g. `M`, `T`, `W`) for the caller's locale.
    public let letter: String
    /// True when the primary standard sit was completed on `iso`.
    public let done: Bool
    /// True for the trailing column (the caller's local "today").
    public let isToday: Bool

    public var id: String { iso }

    public init(iso: String, letter: String, done: Bool, isToday: Bool) {
        self.iso = iso
        self.letter = letter
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
    public var primaryDoneToday: Bool
    public var secondDoneToday: Bool
    public var streak: Int
    /// #84 follow-up: ISO local-day strings (`yyyy-MM-dd`) within the trailing
    /// 7-day window on which the primary standard sit was completed. Drives the
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
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        streak: Int,
        completedDates: [String] = [],
        lastUpdated: Date
    ) {
        self.isLoggedIn = isLoggedIn
        self.userId = userId
        self.currentDay = currentDay
        self.secondTrackDay = secondTrackDay
        self.dualTrackEnabled = dualTrackEnabled
        self.primaryDoneToday = primaryDoneToday
        self.secondDoneToday = secondDoneToday
        self.streak = streak
        self.completedDates = completedDates
        self.lastUpdated = lastUpdated
    }

    private enum CodingKeys: String, CodingKey {
        case isLoggedIn, userId, currentDay, secondTrackDay, dualTrackEnabled
        case primaryDoneToday, secondDoneToday, streak, completedDates, lastUpdated
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
        primaryDoneToday = try c.decode(Bool.self, forKey: .primaryDoneToday)
        secondDoneToday = try c.decode(Bool.self, forKey: .secondDoneToday)
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
        streak: 0,
        completedDates: [],
        lastUpdated: .distantPast
    )

    /// Primary-track duration in seconds for the widget readout.
    public var primaryDurationSeconds: Int {
        StillPoint.duration(forDay: max(currentDay, 1))
    }

    /// Whether the user has finished today's primary standard sit.
    public func isPrimaryCompleteForToday(at now: Date = Date()) -> Bool {
        primaryDoneToday && WidgetDataStore.isSameLocalDay(lastUpdated, now)
    }

    /// Trailing 7-day window (oldest → newest, ending on the caller's local
    /// "today") of weekday marks for the Duolingo-style row. `now`'s column is
    /// checked when either `completedDates` records it or the primary sit is
    /// already complete today.
    public func weekMarks(now: Date = Date(), calendar: Calendar = .current) -> [WidgetDayMark] {
        let completed = Set(completedDates)
        let start = calendar.startOfDay(for: now)
        let symbols = WidgetData.narrowWeekdaySymbols(calendar: calendar)
        return (0..<7).reversed().compactMap { offset -> WidgetDayMark? in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: start) else { return nil }
            let iso = WidgetDataStore.localDayString(date, calendar: calendar)
            let isToday = offset == 0
            let done = completed.contains(iso) || (isToday && isPrimaryCompleteForToday(at: now))
            let weekday = calendar.component(.weekday, from: date)
            let letter = symbols.isEmpty ? "" : symbols[(weekday - 1) % symbols.count]
            return WidgetDayMark(iso: iso, letter: letter, done: done, isToday: isToday)
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

    /// Widget gallery / Xcode preview fixture.
    public static let preview = WidgetData(
        isLoggedIn: true,
        userId: "preview",
        currentDay: 24,
        secondTrackDay: 8,
        dualTrackEnabled: false,
        primaryDoneToday: false,
        secondDoneToday: false,
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
    /// `completedPrimaryDates`, when supplied (from a real `getSessions()` fetch),
    /// becomes the authoritative 7-day completion set. When omitted, the prior
    /// snapshot's dates are carried forward so the fast, network-free sync path
    /// never wipes history it can't recompute. Today is always folded in when the
    /// primary sit is done, so completing a sit checks today's box immediately.
    public static func makeSnapshot(
        user: UserDTO?,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        now: Date = Date(),
        previous: WidgetData? = nil,
        completedPrimaryDates: Set<String>? = nil
    ) -> WidgetData {
        guard let user else {
            return .loggedOut
        }

        let prior = previous ?? load()
        let streak = resolvedStreak(
            userId: user.id,
            primaryDoneToday: primaryDoneToday,
            previous: prior,
            now: now
        )

        let window = Set(localDayStrings(lastN: 7, endingAt: now))
        var dates: Set<String>
        if let completedPrimaryDates {
            dates = completedPrimaryDates.intersection(window)
        } else if let prior, prior.isLoggedIn, prior.userId == user.id {
            // Carry forward what we already knew; drop the other account's history.
            dates = Set(prior.completedDates).intersection(window)
        } else {
            dates = []
        }
        if primaryDoneToday {
            dates.insert(localDayString(now))
        }

        return WidgetData(
            isLoggedIn: true,
            userId: user.id,
            currentDay: StillPoint.clampedCurrentDay(for: user),
            secondTrackDay: max(user.secondTrackDay, 1),
            dualTrackEnabled: user.dualTrackEnabled,
            primaryDoneToday: primaryDoneToday,
            secondDoneToday: secondDoneToday,
            streak: streak,
            completedDates: dates.sorted(),
            lastUpdated: now
        )
    }

    /// The set of local days in the trailing 7-day window on which a completed
    /// primary standard sit was recorded. Quick and breath sits are excluded
    /// (they don't advance the daily practice), matching `SessionStatistics`.
    /// Pure and network-free so it's unit-testable; the caller supplies sessions.
    public static func recentCompletedPrimaryDates(
        from sessions: [SessionDTO],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Set<String> {
        let window = Set(localDayStrings(lastN: 7, endingAt: now, calendar: calendar))
        var result = Set<String>()
        for session in sessions
        where session.completed
            && session.sessionType == .standard
            && (session.track ?? .primary) == .primary {
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
        if data.primaryDoneToday {
            copy.streak = max(data.streak, 0)
        } else {
            copy.streak = 0
        }
        // Keep completion history bounded to the window the row can render.
        let window = Set(localDayStrings(lastN: 7, endingAt: now))
        copy.completedDates = data.completedDates.filter { window.contains($0) }
        return copy
    }

    /// Increment streak once per local day when the primary track flips to done.
    /// Preserves the last known streak across launches; resets on account switch.
    public static func resolvedStreak(
        userId: String,
        primaryDoneToday: Bool,
        previous: WidgetData?,
        now: Date = Date()
    ) -> Int {
        guard let previous, previous.isLoggedIn, previous.userId == userId else {
            return primaryDoneToday ? 1 : 0
        }

        if primaryDoneToday && !previous.primaryDoneToday {
            return max(previous.streak, 0) + 1
        }

        if primaryDoneToday && !isSameLocalDay(previous.lastUpdated, now) {
            // New local day and today is already complete (e.g. cold start after sync).
            return max(previous.streak, 0) + 1
        }

        if !primaryDoneToday && !isSameLocalDay(previous.lastUpdated, now) {
            // New day before today's sit: keep streak when yesterday was completed.
            if previous.primaryDoneToday {
                return max(previous.streak, 0)
            }
            return 0
        }

        return max(previous.streak, 0)
    }

    static func isSameLocalDay(_ lhs: Date, _ rhs: Date) -> Bool {
        Calendar.current.isDate(lhs, inSameDayAs: rhs)
    }

    /// Local-calendar `yyyy-MM-dd` for `date`, matching how the app stamps
    /// `sessionDate` (local day, POSIX locale) so string equality lines up.
    public static func localDayString(_ date: Date, calendar: Calendar = .current) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.calendar = calendar
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
