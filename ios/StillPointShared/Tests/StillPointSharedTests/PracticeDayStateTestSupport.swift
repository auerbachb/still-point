import Foundation
@testable import StillPointShared

/// What the yesterday lookup returns once the test lets it settle.
enum YesterdayRead: Sendable {
    case answered(primary: Bool, second: Bool)
    case failed
}

/// What the credited-day badge query returns (#970).
enum BadgeRead: Sendable {
    case answered(primary: Bool, second: Bool)
    case failed
}

/// The order `AppViewModel` works in, cut down to its practice-day state and the two
/// paths that race in #894: the yesterday lookup in `resolvePreviousPracticeDay(now:)`,
/// which the tests hold open, and the network-free path a finished sit takes,
/// `markPracticeDoneToday` followed by the rollover its `syncWidgetData()` opens with.
/// For #969 and #970 it also runs the rest of a refresh, `refreshTracksDoneToday()`,
/// with its credited-day badge query.
@MainActor
final class PracticeDayScreen {
    private(set) var state = PracticeDayState()
    let calendar: Calendar
    var dualTrack = false

    /// - Parameter lastUsed: when the app last rolled its flags over, with nothing
    ///   sat since.
    init(calendar: Calendar, lastUsed: Date) {
        self.calendar = calendar
        state.rollOverIfNeeded(now: lastUsed, dualTrack: dualTrack, calendar: calendar)
    }

    /// A launch, a sign-in or an account adoption (#969): `resetTrackCompletionBadges()`
    /// and no rollover since, so the flags have no stamp yet.
    init(launchedWith calendar: Calendar) {
        self.calendar = calendar
        state.reset()
    }

    /// `resolvePreviousPracticeDay(now:)`, with `read` standing in for
    /// `getTracksDoneToday(date:)` on yesterday.
    func resolvePreviousPracticeDay(now: Date, reading read: () async -> YesterdayRead) async {
        guard let ticket = state.beginPreviousDayRead(now: now, calendar: calendar) else { return }
        switch await read() {
        case let .answered(primary, second):
            state.applyPreviousDayAnswer(
                TracksDoneTodayDTO(primary: primary, second: second),
                ticket: ticket,
                now: now,
                dualTrack: dualTrack,
                calendar: calendar
            )
        case .failed:
            state.applyFailedPreviousDayRead(ticket: ticket, now: now, dualTrack: dualTrack, calendar: calendar)
        }
    }

    /// `refreshTracksDoneToday()` at rest: the yesterday lookup settling with
    /// `yesterdayRead`, the rollover, the credited-day badge query settling with
    /// `badgeRead`, then the rollover its `syncWidgetData()` opens with. It leaves out
    /// the rollover from the stored widget snapshot. That one only lowers local flags,
    /// once the snapshot's day is no longer open, and in these tests the rollover
    /// above has already retired them by then.
    func refresh(at now: Date, yesterday yesterdayRead: YesterdayRead, badges badgeRead: BadgeRead) async {
        await resolvePreviousPracticeDay(now: now, reading: { yesterdayRead })
        state.rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
        let credited = state.creditedSessionDate(now: now, dualTrack: dualTrack, calendar: calendar)
        switch badgeRead {
        case let .answered(primary, second):
            state.applyTracksDoneAnswer(
                TracksDoneTodayDTO(primary: primary, second: second),
                creditedDate: credited,
                now: now,
                calendar: calendar
            )
        case .failed:
            state.applyFailedTracksDoneRead(now: now, dualTrack: dualTrack, calendar: calendar)
        }
        state.rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
    }

    /// The credited-day badge query that left at `leftAt` for `creditedDate`, landing
    /// now with `primary`/`second`, then the rollover its `syncWidgetData()` opens with
    /// at `landedAt`.
    func landBadgeAnswer(primary: Bool, second: Bool, creditedDate: String, leftAt: Date, landedAt: Date) {
        state.applyTracksDoneAnswer(
            TracksDoneTodayDTO(primary: primary, second: second),
            creditedDate: creditedDate,
            now: leftAt,
            calendar: calendar
        )
        state.rollOverIfNeeded(now: landedAt, dualTrack: dualTrack, calendar: calendar)
    }

    /// `markPracticeDoneToday(sessionType:track:)`, then the rollover its
    /// `syncWidgetData()` opens with.
    func finishSit(_ sessionType: SessionType, track: Track = .primary, at now: Date) {
        state.recordCompletion(sessionType: sessionType, track: track, now: now, dualTrack: dualTrack, calendar: calendar)
        state.rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
    }

    /// `resetTrackCompletionBadges()`: a sign-out, a sign-in, or an auth check that
    /// adopts the account.
    func reset() {
        state.reset()
    }

    /// The day the next sit is stored on.
    func creditedSessionDate(at now: Date) -> String {
        state.creditedSessionDate(now: now, dualTrack: dualTrack, calendar: calendar)
    }
}

/// Fixtures shared by the `PracticeDayState*Tests` suites, split by concern out of
/// one `PracticeDayStateTests` (#1129), the way `WidgetDataTestSupport` serves the
/// `WidgetData*Tests` suites (#760). A suite adopts the protocol to call them exactly
/// as it did when they were its private members, which kept every moved test body
/// unchanged. A helper only one suite uses stays private to that suite.
@MainActor
protocol PracticeDayStateTestSupport {}

extension PracticeDayStateTestSupport {
    var yesterday: String { "2026-10-26" }
    var today: String { "2026-10-27" }

    /// A fixed zone, so the hour checks do not depend on where the tests run.
    var newYork: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    func october(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        newYork.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    /// The app was last used at 20:00 yesterday, and nothing was sat that day.
    func makeScreen() -> PracticeDayScreen {
        PracticeDayScreen(calendar: newYork, lastUsed: october(26, 20))
    }

    /// The app has just launched (#969), so nothing has rolled the flags over yet.
    func makeLaunchedScreen() -> PracticeDayScreen {
        PracticeDayScreen(launchedWith: newYork)
    }

    /// The local day the flags' stamp names.
    func stampDay(_ screen: PracticeDayScreen) -> String? {
        screen.state.doneTodayFlagsStamp.map { SessionCalendar.localIsoDate(now: $0, calendar: newYork) }
    }
}
