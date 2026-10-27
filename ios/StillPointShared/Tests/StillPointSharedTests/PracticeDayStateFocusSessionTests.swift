import Foundation
import Testing
@testable import StillPointShared

/// Issue #839: a focus session leaves the practice-day flags alone.
///
/// Split out of one `PracticeDayStateTests` (#1129); fixtures in `PracticeDayStateTestSupport`.
@MainActor
struct PracticeDayStateFocusSessionTests: PracticeDayStateTestSupport {
    // MARK: - Focus sessions (#839)

    /// A focus session is not meditation practice (#765). On either track it raises
    /// none of the flags and leaves before the rollover, so the flags still describe
    /// the day they did before it.
    @Test func testAFocusSessionRaisesNoFlagAndRollsNothingOver() {
        let lastUsed = october(26, 20)
        for track in [Track.primary, .second] {
            var state = PracticeDayState()
            state.rollOverIfNeeded(now: lastUsed, dualTrack: true, calendar: newYork)

            state.recordCompletion(sessionType: .focus, track: track, now: october(27, 9), dualTrack: true, calendar: newYork)

            #expect(!state.practiceDoneToday, "a focus session on \(track) raised practiceDoneToday")
            #expect(!state.primaryStandardDoneToday, "a focus session on \(track) raised primaryStandardDoneToday")
            #expect(!state.secondPracticeDoneToday, "a focus session on \(track) raised secondPracticeDoneToday")
            #expect(state.doneTodayFlagsStamp == lastUsed, "a focus session on \(track) rolled the flags over")
        }
    }
}
