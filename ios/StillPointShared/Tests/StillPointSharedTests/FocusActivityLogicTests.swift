import Foundation
import Testing
@testable import StillPointShared

/// #840 (focus activity tracking 5/5, #765): the iOS focus timer's rules.
/// `shared/test-fixtures/focusActivity.json` also backs the web suite
/// (`src/lib/focusActivity.test.ts`), so the rules duplicated from web cannot drift.
struct FocusActivityLogicTests {
    private let start = Date(timeIntervalSince1970: 1_793_016_000)

    private func at(_ seconds: Double) -> Date {
        start.addingTimeInterval(seconds)
    }

    private func loadFixture() throws -> FocusActivityFixture {
        try SharedFixtures.load("focusActivity.json", as: FocusActivityFixture.self)
    }

    private func reason(_ raw: String) throws -> FocusEndReason {
        switch raw {
        case "expired": return .expired
        case "ended": return .ended
        default:
            Issue.record("unknown reason \(raw)")
            throw CocoaError(.coderInvalidValue)
        }
    }

    /// A fixed zone, so the date checks do not depend on where the tests run.
    private var newYork: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    private func october(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        newYork.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    private var defaultPrefs: AudioEngine.SoundPrefs { .defaults }

    // MARK: - Shared fixture

    @Test func testGoalTextMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(!fixture.formatGoal.isEmpty)
        for testCase in fixture.formatGoal {
            #expect(FocusActivity.formatGoal(testCase.seconds) == testCase.expected, "formatGoal \(testCase.seconds)")
        }
    }

    @Test func testCountdownTextMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(!fixture.countdownDisplay.isEmpty)
        for testCase in fixture.countdownDisplay {
            #expect(FocusActivity.countdownDisplay(testCase.seconds) == testCase.expected, "countdownDisplay \(testCase.seconds)")
        }
        #expect(!fixture.countdownShowsHours.isEmpty)
        for testCase in fixture.countdownShowsHours {
            #expect(
                FocusActivity.countdownShowsHours(goalSeconds: testCase.goalSeconds) == testCase.expected,
                "countdownShowsHours \(testCase.goalSeconds)"
            )
        }
    }

    @Test func testRemainingSecondsMatchSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(!fixture.remainingSeconds.isEmpty)
        for testCase in fixture.remainingSeconds {
            #expect(
                FocusActivity.remainingSeconds(
                    startedAt: start,
                    now: at(testCase.elapsedMs / 1000),
                    goalSeconds: testCase.goalSeconds
                ) == testCase.expected,
                Comment(rawValue: testCase.name)
            )
        }
    }

    @Test func testResolveEndMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(!fixture.resolveEnd.isEmpty)
        for testCase in fixture.resolveEnd {
            let expected: FocusSessionEnd = testCase.expected.map {
                .save(FocusSessionResult(duration: $0.duration, actualTime: $0.actualTime, completed: $0.completed))
            } ?? .nothingToSave
            #expect(
                FocusActivity.resolveEnd(
                    startedAt: start,
                    now: at(testCase.elapsedMs / 1000),
                    goalSeconds: testCase.goalSeconds,
                    reason: try reason(testCase.reason)
                ) == expected,
                Comment(rawValue: testCase.name)
            )
        }
    }

    @Test func testGoalStepAfterACompletedSaveMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(!fixture.focusActivityDayAfterCompletedSave.isEmpty)
        for testCase in fixture.focusActivityDayAfterCompletedSave {
            #expect(
                FocusActivity.focusActivityDayAfterCompletedSave(
                    currentDay: testCase.currentDay,
                    sessionDay: testCase.sessionDay
                ) == testCase.expected,
                Comment(rawValue: testCase.name)
            )
        }
    }

    @Test func testPickerCategoriesMatchSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(FocusCategory.allCases.map(\.rawValue) == fixture.categories.map(\.id))
        #expect(FocusCategory.allCases.map(\.displayLabel) == fixture.categories.map(\.label))
        #expect(FocusCategory.allCases.map(\.pickerDescription) == fixture.categories.map(\.description))
    }

    // MARK: - Text

    @Test func testGoalTextForTheWholeGoalLadder() {
        #expect(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 1)) == "1 min")
        #expect(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 2)) == "2 min")
        #expect(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 61)) == "1 hr 1 min")
        #expect(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 120)) == "2 hr")
        #expect(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 500)) == "2 hr")
        #expect(FocusActivity.formatGoal(-60) == "0 min")
    }

    @Test func testSpokenDurationForVoiceOver() {
        #expect(FocusActivity.spokenDuration(0) == "0 seconds")
        #expect(FocusActivity.spokenDuration(-4) == "0 seconds")
        #expect(FocusActivity.spokenDuration(1) == "1 second")
        #expect(FocusActivity.spokenDuration(59) == "59 seconds")
        #expect(FocusActivity.spokenDuration(60) == "1 minute")
        #expect(FocusActivity.spokenDuration(65) == "1 minute 5 seconds")
        #expect(FocusActivity.spokenDuration(120) == "2 minutes")
        #expect(FocusActivity.spokenDuration(3600) == "1 hour")
        #expect(FocusActivity.spokenDuration(3661) == "1 hour 1 minute 1 second")
        #expect(FocusActivity.spokenDuration(5400) == "1 hour 30 minutes")
        #expect(FocusActivity.spokenDuration(7200) == "2 hours")
    }

    // MARK: - Running session and its end

    @Test func testRunCountsDownFromItsPinnedGoal() {
        let run = FocusSessionRun(goalSeconds: 120, startedAt: start)

        #expect(run.remainingSeconds(now: at(0)) == 120)
        #expect(run.remainingSeconds(now: at(20.5)) == 100)
        #expect(run.remainingSeconds(now: at(120)) == 0)
        #expect(run.remainingSeconds(now: at(4000)) == 0)
        #expect(!run.hasEnded)
    }

    @Test func testRunReportsItsEndOnce() {
        var run = FocusSessionRun(goalSeconds: 60, startedAt: start)

        #expect(run.end(reason: .ended, now: at(20)) == .save(FocusSessionResult(duration: 60, actualTime: 20, completed: false)))
        #expect(run.hasEnded)
        // A second End tap before the screen goes reports nothing.
        #expect(run.end(reason: .ended, now: at(21)) == nil)
        // Nor does the countdown running out afterwards.
        #expect(run.end(reason: .expired, now: at(60)) == nil)
    }

    @Test func testExpiryAndAnEndInTheSameTurnSaveOnce() {
        var run = FocusSessionRun(goalSeconds: 60, startedAt: start)

        let expiry = run.end(reason: .expired, now: at(60))
        let endTap = run.end(reason: .ended, now: at(60))

        #expect(expiry == .save(FocusSessionResult(duration: 60, actualTime: 60, completed: true)))
        #expect(endTap == nil)
    }

    @Test func testAnImmediateEndEndsTheRunWithNothingToSave() {
        var run = FocusSessionRun(goalSeconds: 60, startedAt: start)

        #expect(run.end(reason: .ended, now: at(0.4)) == .nothingToSave)
        #expect(run.hasEnded)
        #expect(run.end(reason: .ended, now: at(5)) == nil)
    }

    // MARK: - Cues

    @Test func testOnlyACountdownThatRanOutIsAnnounced() {
        let everything = AudioEngine.SoundPrefs(
            tick: true,
            chime: true,
            completion: true,
            voiceCountdown: true,
            haptics: true
        )

        #expect(FocusActivity.endCues(reason: .expired, prefs: everything) == FocusActivity.EndCues(playCompletion: true, haptic: .sessionEnd))
        // End is the person's own signal: no sound and no buzz, whatever is on.
        #expect(FocusActivity.endCues(reason: .ended, prefs: everything) == FocusActivity.EndCues(playCompletion: false, haptic: nil))
    }

    @Test func testEndCuesFollowTheSoundAndHapticSettings() {
        // The defaults: completion sound on, haptics off.
        #expect(FocusActivity.endCues(reason: .expired, prefs: defaultPrefs) == FocusActivity.EndCues(playCompletion: true, haptic: nil))
        let hapticsOnly = AudioEngine.SoundPrefs(tick: false, chime: false, completion: false, haptics: true)
        #expect(FocusActivity.endCues(reason: .expired, prefs: hapticsOnly) == FocusActivity.EndCues(playCompletion: false, haptic: .sessionEnd))
        let silent = AudioEngine.SoundPrefs(tick: true, chime: true, completion: false, haptics: false)
        #expect(FocusActivity.endCues(reason: .expired, prefs: silent) == FocusActivity.EndCues(playCompletion: false, haptic: nil))
    }

    // MARK: - Save request

    @Test func testSessionRequestForACompletedSession() throws {
        let clientSessionId = UUID()
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 180, actualTime: 180, completed: true),
            category: .listening,
            focusActivityDay: 3,
            endedAt: october(27, 14),
            clientSessionId: clientSessionId,
            calendar: newYork
        )

        #expect(request.sessionType == .focus)
        #expect(request.focusCategory == .listening)
        #expect(request.dayNumber == 3)
        #expect(request.duration == 180)
        #expect(request.actualTime == 180)
        #expect(request.completed)
        #expect(request.bonusSeconds == 0)
        #expect(request.clearPercent == 0)
        #expect(request.thoughtCount == 0)
        #expect(request.mindStateLog.isEmpty)
        #expect(request.attentionLog == nil)
        #expect(request.breathCount == nil)
        #expect(request.ambientSoundSummary == nil)
        #expect(request.track == .primary)
        #expect(request.clientSessionId == clientSessionId)
        #expect(request.sessionDate == "2026-10-27")

        let data = try JSONEncoder().encode(request)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect((object["sessionType"] as? String) == "focus")
        #expect((object["focusCategory"] as? String) == "listening")
        #expect((object["dayNumber"] as? Int) == 3)
        #expect((object["completed"] as? Bool) == true)
    }

    @Test func testSessionRequestForAnEndedEarlySessionKeepsTheGoalAsItsDuration() {
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 120, actualTime: 20, completed: false),
            category: .reading,
            focusActivityDay: 2,
            endedAt: october(27, 14),
            clientSessionId: UUID(),
            calendar: newYork
        )

        #expect(request.duration == 120)
        #expect(request.actualTime == 20)
        #expect(!request.completed)
        #expect(request.dayNumber == 2)
    }

    /// Before 6:00, with yesterday's sit still open, a meditation sit is credited to
    /// yesterday. A focus session is dated the calendar day it ended on.
    @Test func testSessionRequestIsDatedThePlainLocalDayNotTheCreditedPracticeDay() {
        let earlyMorning = october(27, 5, 30)
        var practiceDay = PracticeDayState()
        let credited = practiceDay.creditedSessionDate(now: earlyMorning, dualTrack: false, calendar: newYork)

        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 60, actualTime: 60, completed: true),
            category: .writing,
            focusActivityDay: 1,
            endedAt: earlyMorning,
            clientSessionId: UUID(),
            calendar: newYork
        )

        #expect(credited == "2026-10-26")
        #expect(request.sessionDate == "2026-10-27")
    }

    @Test func testSessionRequestDayNumberIsAtLeastOne() {
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 60, actualTime: 10, completed: false),
            category: .reading,
            focusActivityDay: 0,
            endedAt: october(27, 14),
            clientSessionId: UUID(),
            calendar: newYork
        )

        // `POST /api/sessions` rejects a missing or zero `dayNumber`.
        #expect(request.dayNumber == 1)
    }

    /// The session the timer saves is not meditation practice: as the local queue
    /// hands it back, it checks no widget row and feeds no streak.
    /// `PracticeDayStateTests.testAFocusSessionRaisesNoFlagAndRollsNothingOver`
    /// covers the practice-day flags.
    @Test func testASavedFocusSessionChecksNoWidgetRowAndFeedsNoStreak() {
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 60, actualTime: 60, completed: true),
            category: .reading,
            focusActivityDay: 1,
            endedAt: october(27, 14),
            clientSessionId: UUID(),
            calendar: newYork
        )
        let session = SessionSyncCoordinator.sessionDTO(from: request, id: "focus-1")

        #expect(session.sessionType == .focus)
        #expect(session.focusCategory == .reading)
        #expect(session.completed)
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(session, track: .primary))
        #expect(!WidgetDataStore.sessionCountsForWidgetPractice(session, track: .second))
        #expect(!WidgetDataStore.sessionCountsForServerStreak(session))
    }
}
