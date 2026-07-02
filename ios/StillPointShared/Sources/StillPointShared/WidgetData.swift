import Foundation

/// App Group identifier shared with the main app, monitor extension, and widget.
public enum WidgetAppGroup {
    public static let id = "group.com.brettonauerbach.stillpoint"
    public static let dataKey = "widget.habitData.v1"
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
        self.lastUpdated = lastUpdated
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
        lastUpdated: .distantPast
    )

    /// Primary-track duration in seconds for the widget readout.
    public var primaryDurationSeconds: Int {
        StillPoint.duration(forDay: max(currentDay, 1))
    }

    /// Whether the user has finished today's primary standard sit.
    public var isPrimaryCompleteForToday: Bool {
        primaryDoneToday
    }
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
    public static func makeSnapshot(
        user: UserDTO?,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        now: Date = Date(),
        previous: WidgetData? = nil
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

        return WidgetData(
            isLoggedIn: true,
            userId: user.id,
            currentDay: StillPoint.clampedCurrentDay(for: user),
            secondTrackDay: max(user.secondTrackDay, 1),
            dualTrackEnabled: user.dualTrackEnabled,
            primaryDoneToday: primaryDoneToday,
            secondDoneToday: secondDoneToday,
            streak: streak,
            lastUpdated: now
        )
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

        if !primaryDoneToday && !isSameLocalDay(previous.lastUpdated, now) {
            // A new local day without a completed sit yet — streak is broken.
            return 0
        }

        return max(previous.streak, 0)
    }

    private static func isSameLocalDay(_ lhs: Date, _ rhs: Date) -> Bool {
        Calendar.current.isDate(lhs, inSameDayAs: rhs)
    }
}
