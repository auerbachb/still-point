import XCTest
@testable import StillPointShared

/// #840 (focus activity tracking 5/5, #765): the iOS focus timer's rules.
/// `shared/test-fixtures/focusActivity.json` also backs the web suite
/// (`src/lib/focusActivity.test.ts`), so the rules duplicated from web cannot drift.
final class FocusActivityLogicTests: XCTestCase {
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
            XCTFail("unknown reason \(raw)")
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

    func testGoalTextMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertFalse(fixture.formatGoal.isEmpty)
        for testCase in fixture.formatGoal {
            XCTAssertEqual(FocusActivity.formatGoal(testCase.seconds), testCase.expected, "formatGoal \(testCase.seconds)")
        }
    }

    func testCountdownTextMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertFalse(fixture.countdownDisplay.isEmpty)
        for testCase in fixture.countdownDisplay {
            XCTAssertEqual(
                FocusActivity.countdownDisplay(testCase.seconds),
                testCase.expected,
                "countdownDisplay \(testCase.seconds)"
            )
        }
        XCTAssertFalse(fixture.countdownShowsHours.isEmpty)
        for testCase in fixture.countdownShowsHours {
            XCTAssertEqual(
                FocusActivity.countdownShowsHours(goalSeconds: testCase.goalSeconds),
                testCase.expected,
                "countdownShowsHours \(testCase.goalSeconds)"
            )
        }
    }

    func testRemainingSecondsMatchSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertFalse(fixture.remainingSeconds.isEmpty)
        for testCase in fixture.remainingSeconds {
            XCTAssertEqual(
                FocusActivity.remainingSeconds(
                    startedAt: start,
                    now: at(testCase.elapsedMs / 1000),
                    goalSeconds: testCase.goalSeconds
                ),
                testCase.expected,
                testCase.name
            )
        }
    }

    func testResolveEndMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertFalse(fixture.resolveEnd.isEmpty)
        for testCase in fixture.resolveEnd {
            let expected: FocusSessionEnd = testCase.expected.map {
                .save(FocusSessionResult(duration: $0.duration, actualTime: $0.actualTime, completed: $0.completed))
            } ?? .nothingToSave
            XCTAssertEqual(
                FocusActivity.resolveEnd(
                    startedAt: start,
                    now: at(testCase.elapsedMs / 1000),
                    goalSeconds: testCase.goalSeconds,
                    reason: try reason(testCase.reason)
                ),
                expected,
                testCase.name
            )
        }
    }

    func testGoalStepAfterACompletedSaveMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertFalse(fixture.focusActivityDayAfterCompletedSave.isEmpty)
        for testCase in fixture.focusActivityDayAfterCompletedSave {
            XCTAssertEqual(
                FocusActivity.focusActivityDayAfterCompletedSave(
                    currentDay: testCase.currentDay,
                    sessionDay: testCase.sessionDay
                ),
                testCase.expected,
                testCase.name
            )
        }
    }

    func testPickerCategoriesMatchSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertEqual(FocusCategory.allCases.map(\.rawValue), fixture.categories.map(\.id))
        XCTAssertEqual(FocusCategory.allCases.map(\.displayLabel), fixture.categories.map(\.label))
        XCTAssertEqual(FocusCategory.allCases.map(\.pickerDescription), fixture.categories.map(\.description))
    }

    // MARK: - Text

    func testGoalTextForTheWholeGoalLadder() {
        XCTAssertEqual(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 1)), "1 min")
        XCTAssertEqual(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 2)), "2 min")
        XCTAssertEqual(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 61)), "1 hr 1 min")
        XCTAssertEqual(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 120)), "2 hr")
        XCTAssertEqual(FocusActivity.formatGoal(StillPoint.focusDuration(forDay: 500)), "2 hr")
        XCTAssertEqual(FocusActivity.formatGoal(-60), "0 min")
    }

    func testSpokenDurationForVoiceOver() {
        XCTAssertEqual(FocusActivity.spokenDuration(0), "0 seconds")
        XCTAssertEqual(FocusActivity.spokenDuration(-4), "0 seconds")
        XCTAssertEqual(FocusActivity.spokenDuration(1), "1 second")
        XCTAssertEqual(FocusActivity.spokenDuration(59), "59 seconds")
        XCTAssertEqual(FocusActivity.spokenDuration(60), "1 minute")
        XCTAssertEqual(FocusActivity.spokenDuration(65), "1 minute 5 seconds")
        XCTAssertEqual(FocusActivity.spokenDuration(120), "2 minutes")
        XCTAssertEqual(FocusActivity.spokenDuration(3600), "1 hour")
        XCTAssertEqual(FocusActivity.spokenDuration(3661), "1 hour 1 minute 1 second")
        XCTAssertEqual(FocusActivity.spokenDuration(5400), "1 hour 30 minutes")
        XCTAssertEqual(FocusActivity.spokenDuration(7200), "2 hours")
    }

    // MARK: - Running session and its end

    func testRunCountsDownFromItsPinnedGoal() {
        let run = FocusSessionRun(goalSeconds: 120, startedAt: start)

        XCTAssertEqual(run.remainingSeconds(now: at(0)), 120)
        XCTAssertEqual(run.remainingSeconds(now: at(20.5)), 100)
        XCTAssertEqual(run.remainingSeconds(now: at(120)), 0)
        XCTAssertEqual(run.remainingSeconds(now: at(4000)), 0)
        XCTAssertFalse(run.hasEnded)
    }

    func testRunReportsItsEndOnce() {
        var run = FocusSessionRun(goalSeconds: 60, startedAt: start)

        XCTAssertEqual(
            run.end(reason: .ended, now: at(20)),
            .save(FocusSessionResult(duration: 60, actualTime: 20, completed: false))
        )
        XCTAssertTrue(run.hasEnded)
        // A second End tap before the screen goes reports nothing.
        XCTAssertNil(run.end(reason: .ended, now: at(21)))
        // Nor does the countdown running out afterwards.
        XCTAssertNil(run.end(reason: .expired, now: at(60)))
    }

    func testExpiryAndAnEndInTheSameTurnSaveOnce() {
        var run = FocusSessionRun(goalSeconds: 60, startedAt: start)

        let expiry = run.end(reason: .expired, now: at(60))
        let endTap = run.end(reason: .ended, now: at(60))

        XCTAssertEqual(expiry, .save(FocusSessionResult(duration: 60, actualTime: 60, completed: true)))
        XCTAssertNil(endTap)
    }

    func testAnImmediateEndEndsTheRunWithNothingToSave() {
        var run = FocusSessionRun(goalSeconds: 60, startedAt: start)

        XCTAssertEqual(run.end(reason: .ended, now: at(0.4)), .nothingToSave)
        XCTAssertTrue(run.hasEnded)
        XCTAssertNil(run.end(reason: .ended, now: at(5)))
    }

    // MARK: - Cues

    func testOnlyACountdownThatRanOutIsAnnounced() {
        let everything = AudioEngine.SoundPrefs(
            tick: true,
            chime: true,
            completion: true,
            voiceCountdown: true,
            haptics: true
        )

        XCTAssertEqual(
            FocusActivity.endCues(reason: .expired, prefs: everything),
            FocusActivity.EndCues(playCompletion: true, haptic: .sessionEnd)
        )
        // End is the person's own signal: no sound and no buzz, whatever is on.
        XCTAssertEqual(
            FocusActivity.endCues(reason: .ended, prefs: everything),
            FocusActivity.EndCues(playCompletion: false, haptic: nil)
        )
    }

    func testEndCuesFollowTheSoundAndHapticSettings() {
        // The defaults: completion sound on, haptics off.
        XCTAssertEqual(
            FocusActivity.endCues(reason: .expired, prefs: defaultPrefs),
            FocusActivity.EndCues(playCompletion: true, haptic: nil)
        )
        let hapticsOnly = AudioEngine.SoundPrefs(tick: false, chime: false, completion: false, haptics: true)
        XCTAssertEqual(
            FocusActivity.endCues(reason: .expired, prefs: hapticsOnly),
            FocusActivity.EndCues(playCompletion: false, haptic: .sessionEnd)
        )
        let silent = AudioEngine.SoundPrefs(tick: true, chime: true, completion: false, haptics: false)
        XCTAssertEqual(
            FocusActivity.endCues(reason: .expired, prefs: silent),
            FocusActivity.EndCues(playCompletion: false, haptic: nil)
        )
    }

    // MARK: - Save request

    func testSessionRequestForACompletedSession() throws {
        let clientSessionId = UUID()
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 180, actualTime: 180, completed: true),
            category: .listening,
            focusActivityDay: 3,
            endedAt: october(27, 14),
            clientSessionId: clientSessionId,
            calendar: newYork
        )

        XCTAssertEqual(request.sessionType, .focus)
        XCTAssertEqual(request.focusCategory, .listening)
        XCTAssertEqual(request.dayNumber, 3)
        XCTAssertEqual(request.duration, 180)
        XCTAssertEqual(request.actualTime, 180)
        XCTAssertTrue(request.completed)
        XCTAssertEqual(request.bonusSeconds, 0)
        XCTAssertEqual(request.clearPercent, 0)
        XCTAssertEqual(request.thoughtCount, 0)
        XCTAssertTrue(request.mindStateLog.isEmpty)
        XCTAssertNil(request.attentionLog)
        XCTAssertNil(request.breathCount)
        XCTAssertNil(request.ambientSoundSummary)
        XCTAssertEqual(request.track, .primary)
        XCTAssertEqual(request.clientSessionId, clientSessionId)
        XCTAssertEqual(request.sessionDate, "2026-10-27")

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["sessionType"] as? String, "focus")
        XCTAssertEqual(object["focusCategory"] as? String, "listening")
        XCTAssertEqual(object["dayNumber"] as? Int, 3)
        XCTAssertEqual(object["completed"] as? Bool, true)
    }

    func testSessionRequestForAnEndedEarlySessionKeepsTheGoalAsItsDuration() {
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 120, actualTime: 20, completed: false),
            category: .reading,
            focusActivityDay: 2,
            endedAt: october(27, 14),
            clientSessionId: UUID(),
            calendar: newYork
        )

        XCTAssertEqual(request.duration, 120)
        XCTAssertEqual(request.actualTime, 20)
        XCTAssertFalse(request.completed)
        XCTAssertEqual(request.dayNumber, 2)
    }

    /// Before 6:00, with yesterday's sit still open, a meditation sit is credited to
    /// yesterday. A focus session is dated the calendar day it ended on.
    func testSessionRequestIsDatedThePlainLocalDayNotTheCreditedPracticeDay() {
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

        XCTAssertEqual(credited, "2026-10-26")
        XCTAssertEqual(request.sessionDate, "2026-10-27")
    }

    func testSessionRequestDayNumberIsAtLeastOne() {
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 60, actualTime: 10, completed: false),
            category: .reading,
            focusActivityDay: 0,
            endedAt: october(27, 14),
            clientSessionId: UUID(),
            calendar: newYork
        )

        // `POST /api/sessions` rejects a missing or zero `dayNumber`.
        XCTAssertEqual(request.dayNumber, 1)
    }

    /// The session the timer saves is not meditation practice: as the local queue
    /// hands it back, it checks no widget row and feeds no streak.
    /// `PracticeDayStateTests.testAFocusSessionRaisesNoFlagAndRollsNothingOver`
    /// covers the practice-day flags.
    func testASavedFocusSessionChecksNoWidgetRowAndFeedsNoStreak() {
        let request = FocusActivity.sessionRequest(
            result: FocusSessionResult(duration: 60, actualTime: 60, completed: true),
            category: .reading,
            focusActivityDay: 1,
            endedAt: october(27, 14),
            clientSessionId: UUID(),
            calendar: newYork
        )
        let session = SessionSyncCoordinator.sessionDTO(from: request, id: "focus-1")

        XCTAssertEqual(session.sessionType, .focus)
        XCTAssertEqual(session.focusCategory, .reading)
        XCTAssertTrue(session.completed)
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(session, track: .primary))
        XCTAssertFalse(WidgetDataStore.sessionCountsForWidgetPractice(session, track: .second))
        XCTAssertFalse(WidgetDataStore.sessionCountsForServerStreak(session))
    }
}
