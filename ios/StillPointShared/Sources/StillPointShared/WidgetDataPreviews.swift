import Foundation

// Widget gallery and Xcode preview fixtures.
//
// Their history is an unbroken run, so the streak they claim never contradicts
// the rows they draw (#671).

extension WidgetData {
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
        // Those six days are standard sits, which is what makes the anchor below
        // legitimate: the preview's 12 is a standard-only total (#679).
        standardDates: WidgetDataStore.previewCompletedDates(),
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
        // Track-agnostic (#679): both rows' sits are standard here, and the union
        // is the same six days either way.
        standardDates: WidgetDataStore.previewCompletedDates(),
        serverStreak: 12,
        serverStreakDate: WidgetDataStore.previewCompletedDates().last,
        lastUpdated: Date()
    )
}

extension WidgetDataStore {
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
