import Foundation
import Testing
import StillPointShared

struct HistoryJourneyTests {
    private func makeSession(
        id: String,
        type: SessionType = .standard,
        date: String,
        createdAt: String? = nil,
        completed: Bool = true,
        thoughtCount: Int = 0
    ) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: 1,
            sessionType: type,
            duration: 60,
            completed: completed,
            actualTime: 60,
            clearPercent: 50,
            thoughtCount: thoughtCount,
            mindStateLog: nil,
            sessionDate: date,
            createdAt: createdAt,
            buddySessionId: nil
        )
    }

    // MARK: - Session ordering / per-day indices

    @Test func testSequentialSessionLabelsSameDay() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-04-28"),
            makeSession(id: "b", date: "2026-04-28"),
        ])
        guard case .session(_, let n1) = rows[0],
              case .session(_, let n2) = rows[1] else {
            Issue.record("expected two session rows")
            return
        }
        #expect(n1 == 1)
        #expect(n2 == 2)
    }

    @Test func testSameDaySessionsOrderedByCreatedAt() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "later-id", date: "2026-04-28", createdAt: "2026-04-28T12:00:00.000Z"),
            makeSession(id: "earlier-id", date: "2026-04-28", createdAt: "2026-04-28T10:00:00.000Z"),
        ])
        guard case .session(let first, let n1) = rows[0],
              case .session(let second, let n2) = rows[1] else {
            Issue.record("expected two session rows")
            return
        }
        #expect(first.id == "earlier-id")
        #expect(second.id == "later-id")
        #expect(n1 == 1)
        #expect(n2 == 2)
    }

    // MARK: - Quick sessions in the journey (#379)

    @Test func testQuickOnlySessionsProduceRows() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "q1", type: .quick, date: "2026-06-10"),
        ])
        #expect(rows.count == 1)
        guard case .session(let session, let n) = rows[0] else {
            Issue.record("expected a session row for a quick sit")
            return
        }
        #expect(session.sessionType == .quick)
        #expect(n == 1)
    }

    @Test func testQuickAndStandardMixUsesPerTypeIndices() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "s1", date: "2026-06-10", createdAt: "2026-06-10T08:00:00.000Z"),
            makeSession(id: "q1", type: .quick, date: "2026-06-10", createdAt: "2026-06-10T09:00:00.000Z"),
            makeSession(id: "s2", date: "2026-06-10", createdAt: "2026-06-10T10:00:00.000Z"),
        ])
        #expect(rows.count == 3)
        guard case .session(let first, let n1) = rows[0],
              case .session(let second, let n2) = rows[1],
              case .session(let third, let n3) = rows[2] else {
            Issue.record("expected three session rows")
            return
        }
        // Chronological interleaving preserved...
        #expect(first.id == "s1")
        #expect(second.id == "q1")
        #expect(third.id == "s2")
        // ...while standard numbering ignores the quick sit in between.
        #expect(n1 == 1)
        #expect(n2 == 1)
        #expect(n3 == 2)
    }

    // MARK: - Focus sessions in the journey (#839)

    @Test func testFocusOnlyDayProducesARow() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "f1", type: .focus, date: "2026-10-27"),
        ])
        #expect(rows.count == 1)
        guard case .session(let session, let n) = rows[0] else {
            Issue.record("expected a session row for a focus session")
            return
        }
        #expect(session.sessionType == .focus)
        #expect(n == 1)
    }

    /// Focus sessions are numbered within their own type, so a focus session between
    /// two sits leaves the sits "Session 1" and "Session 2".
    @Test func testFocusAndStandardMixUsesPerTypeIndices() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "s1", date: "2026-10-27", createdAt: "2026-10-27T08:00:00.000Z"),
            makeSession(id: "f1", type: .focus, date: "2026-10-27", createdAt: "2026-10-27T09:00:00.000Z"),
            makeSession(id: "s2", date: "2026-10-27", createdAt: "2026-10-27T10:00:00.000Z"),
            makeSession(id: "f2", type: .focus, date: "2026-10-27", createdAt: "2026-10-27T11:00:00.000Z"),
        ])
        let numbered = rows.compactMap { row -> (String, Int)? in
            guard case .session(let session, let n) = row else { return nil }
            return (session.id, n)
        }
        #expect(numbered.map(\.0) == ["s1", "f1", "s2", "f2"])
        #expect(numbered.map(\.1) == [1, 1, 2, 2])
    }

    /// A focus day between two standard days fills the gap: the journey shows a row for
    /// it, not a missed day, as it does for a quick sit.
    @Test func testFocusDayIsNotAMissedDay() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "s1", date: "2026-10-25"),
            makeSession(id: "f1", type: .focus, date: "2026-10-26"),
            makeSession(id: "s2", date: "2026-10-27"),
        ])
        #expect(rows.count == 3)
        for row in rows {
            guard case .session = row else {
                Issue.record("expected only session rows, got \(row)")
                return
            }
        }
    }

    /// The bars scale to the longest sit. A two-hour focus session stays out of the
    /// scale (its bar is capped at full width), as on web (#836).
    @Test func testBarScaleLeavesOutFocusSessions() {
        func session(_ id: String, type: SessionType, duration: Int, actualTime: Int?) -> SessionDTO {
            SessionDTO(
                id: id,
                dayNumber: 1,
                sessionType: type,
                duration: duration,
                completed: true,
                actualTime: actualTime,
                clearPercent: 50,
                thoughtCount: 0,
                mindStateLog: nil,
                sessionDate: "2026-10-27",
                buddySessionId: nil
            )
        }

        let sits = [
            session("s1", type: .standard, duration: 300, actualTime: 320),
            session("q1", type: .quick, duration: 60, actualTime: nil),
        ]
        let focus = session("f1", type: .focus, duration: 7200, actualTime: 7200)

        #expect(HistoryJourney.barScaleSeconds(for: sits) == 320)
        #expect(HistoryJourney.barScaleSeconds(for: sits + [focus]) == 320)
        // Never under a minute, even with nothing but focus sessions.
        #expect(HistoryJourney.barScaleSeconds(for: [focus]) == 60)
        #expect(HistoryJourney.barScaleSeconds(for: []) == 60)
    }

    // MARK: - Gap collapsing (#379)

    @Test func testShortGapEmitsPerDayMissedRows() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-06-01"),
            makeSession(id: "b", date: "2026-06-04"),
        ])
        #expect(rows.count == 4)
        guard case .missed(let d1) = rows[1], case .missed(let d2) = rows[2] else {
            Issue.record("expected two per-day missed rows for a 2-day gap")
            return
        }
        #expect(d1 == "2026-06-02")
        #expect(d2 == "2026-06-03")
    }

    @Test func testThreeMissedDaysCollapseToRange() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-06-01"),
            makeSession(id: "b", date: "2026-06-05"),
        ])
        #expect(rows.count == 3)
        guard case .missedRange(let start, let end, let count) = rows[1] else {
            Issue.record("expected a collapsed missed range at the 3-day threshold")
            return
        }
        #expect(start == "2026-06-02")
        #expect(end == "2026-06-04")
        #expect(count == 3)
    }

    @Test func testThirtyDayGapCollapsesToSingleRange() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "a", date: "2026-04-01"),
            makeSession(id: "b", date: "2026-05-01"),
        ])
        #expect(rows.count == 3, "prior session must stay reachable: session, one range row, session")
        guard case .session(let first, _) = rows[0],
              case .missedRange(let start, let end, let count) = rows[1],
              case .session(let second, _) = rows[2] else {
            Issue.record("expected session, missedRange, session")
            return
        }
        #expect(first.id == "a")
        #expect(second.id == "b")
        #expect(start == "2026-04-02")
        #expect(end == "2026-04-30")
        #expect(count == 29)
    }

    @Test func testGapSpanningQuickAndStandardSessions() {
        let rows = HistoryJourney.buildRows(fromSessions: [
            makeSession(id: "s1", date: "2026-04-01"),
            makeSession(id: "q1", type: .quick, date: "2026-05-06"),
        ])
        #expect(rows.count == 3)
        guard case .missedRange(_, _, let count) = rows[1],
              case .session(let last, _) = rows[2] else {
            Issue.record("expected missedRange then quick session")
            return
        }
        #expect(count == 34)
        #expect(last.sessionType == .quick)
    }

    // MARK: - Gap adjacent to today (#379)

    @Test func testLongGapAdjacentToTodayCollapses() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-05-01")],
            todayIsoDate: "2026-06-11"
        )
        #expect(rows.count == 2)
        guard case .missedRange(let start, let end, let count) = rows[1] else {
            Issue.record("expected trailing missedRange before today")
            return
        }
        #expect(start == "2026-05-02")
        #expect(end == "2026-06-10", "today itself is never emitted as missed")
        #expect(count == 40)
    }

    @Test func testShortGapAdjacentToTodayEmitsPerDayRows() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-06-09")],
            todayIsoDate: "2026-06-11"
        )
        #expect(rows.count == 2)
        guard case .missed(let date) = rows[1] else {
            Issue.record("expected one trailing missed row")
            return
        }
        #expect(date == "2026-06-10")
    }

    @Test func testNoTrailingGapWhenSessionIsToday() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-06-11")],
            todayIsoDate: "2026-06-11"
        )
        #expect(rows.count == 1)
        guard case .session = rows[0] else {
            Issue.record("expected only the session row")
            return
        }
    }

    @Test func testNoTrailingGapWhenSessionWasYesterday() {
        let rows = HistoryJourney.buildRows(
            fromSessions: [makeSession(id: "a", date: "2026-06-10")],
            todayIsoDate: "2026-06-11"
        )
        #expect(rows.count == 1)
    }

    @Test func testEmptySessionsProduceNoRows() {
        #expect(HistoryJourney.buildRows(fromSessions: [], todayIsoDate: "2026-06-11").isEmpty)
    }

    // MARK: - Stats (quick sits intentionally excluded — #379)

    @Test func testStreakCountsUniqueCalendarDays() {
        let stats = SessionStatistics.calculateStats(for: [
            makeSession(id: "1", date: "2026-04-28"),
            makeSession(id: "2", date: "2026-04-28"),
        ])
        #expect(stats.streak == 1)
    }

    @Test func testStatsExcludeQuickSits() {
        let quickOnly = SessionStatistics.calculateStats(for: [
            makeSession(id: "q1", type: .quick, date: "2026-06-10", thoughtCount: 5),
        ])
        #expect(quickOnly.streak == 0)
        #expect(quickOnly.avgThoughtsPerSession == 0)

        let mixed = SessionStatistics.calculateStats(for: [
            makeSession(id: "s1", date: "2026-06-10", thoughtCount: 10),
            makeSession(id: "q1", type: .quick, date: "2026-06-11", thoughtCount: 5),
        ])
        #expect(mixed.streak == 1, "quick sit on a later day must not extend the streak")
        #expect(mixed.avgThoughtsPerSession == 10, "average must count standard sessions only")
    }

    /// #839: the streak counts standard sits only, so focus sessions neither start one
    /// nor extend one, as for quick sits.
    @Test func testStatsExcludeFocusSessions() {
        let focusOnly = SessionStatistics.calculateStats(for: [
            makeSession(id: "f1", type: .focus, date: "2026-10-26"),
            makeSession(id: "f2", type: .focus, date: "2026-10-27"),
        ])
        #expect(focusOnly.streak == 0)
        #expect(focusOnly.avgClearPercent == 0)

        let mixed = SessionStatistics.calculateStats(for: [
            makeSession(id: "s1", date: "2026-10-26", thoughtCount: 4),
            makeSession(id: "f1", type: .focus, date: "2026-10-27"),
        ])
        #expect(mixed.streak == 1, "a focus session on a later day must not extend the streak")
        #expect(mixed.avgThoughtsPerSession == 4, "average must count standard sessions only")
    }

    // MARK: - Shared cross-platform fixtures (#421)

    // The same golden set is asserted by web buildHistoryJourneyRows; drift between
    // the two implementations breaks CI on at least one platform.
    @Test func testSharedHistoryJourneyFixtures() throws {
        let fixture = try SharedFixtures.load("historyJourney.json", as: HistoryJourneyFixture.self)
        #expect(HistoryJourney.collapseGapThresholdDays == fixture.collapseGapThresholdDays)

        for testCase in fixture.cases {
            let rows = HistoryJourney.buildRows(
                fromSessions: testCase.sessions.map { $0.toSessionDTO() },
                todayIsoDate: testCase.todayIsoDate
            )
            #expect(rows.count == testCase.expectedRows.count, "\(testCase.name): row count")

            for (row, expected) in zip(rows, testCase.expectedRows) {
                switch row {
                case .missed(let date):
                    #expect(expected.kind == "missed", Comment(rawValue: testCase.name))
                    #expect(date == (try #require(expected.date)), Comment(rawValue: testCase.name))
                case .missedRange(let startDate, let endDate, let dayCount):
                    #expect(expected.kind == "missedRange", Comment(rawValue: testCase.name))
                    #expect(startDate == (try #require(expected.startDate)), Comment(rawValue: testCase.name))
                    #expect(endDate == (try #require(expected.endDate)), Comment(rawValue: testCase.name))
                    #expect(dayCount == (try #require(expected.dayCount)), Comment(rawValue: testCase.name))
                case .session(let session, let sessionIndexInDay):
                    #expect(expected.kind == "session", Comment(rawValue: testCase.name))
                    #expect(session.id == (try #require(expected.id)), Comment(rawValue: testCase.name))
                    #expect(sessionIndexInDay == (try #require(expected.sessionIndexInDay)), Comment(rawValue: testCase.name))
                }
            }
        }
    }

    // Web rounds averages to one decimal while iOS returns raw doubles, so the
    // shared fixtures keep them on clean values and assert with a small tolerance.
    @Test func testSharedSessionStatsFixtures() throws {
        let fixture = try SharedFixtures.load("sessionStats.json", as: SessionStatsFixture.self)

        for testCase in fixture.cases {
            let stats = SessionStatistics.calculateStats(for: testCase.sessions.map { $0.toSessionDTO() })
            #expect(stats.streak == testCase.expected.streak, "\(testCase.name): streak")
            #expect(stats.avgClearPercent == testCase.expected.avgClearPercent, "\(testCase.name): avgClearPercent")
            #expect(
                abs(stats.avgThoughtsPerSession - testCase.expected.avgThoughtsPerSession) <= 0.05,
                "\(testCase.name): avgThoughtsPerSession"
            )
            #expect(
                abs(stats.avgThoughtsPerMinute - testCase.expected.avgThoughtsPerMinute) <= 0.05,
                "\(testCase.name): avgThoughtsPerMinute"
            )
            #expect((stats.bonusMinutesTotal ?? 0) == testCase.expected.bonusMinutesTotal, "\(testCase.name): bonusMinutesTotal")
        }
    }

    // MARK: - #767 grace period

    private func localDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    @Test func testGracePeriodCreditsTheUnfinishedDayUntil6am() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let elevenFiftyNine = localDate(2026, 10, 7, 23, 59)
        let twelveThirty = localDate(2026, 10, 8, 0, 30)
        let sixAm = localDate(2026, 10, 8, 6, 0)

        #expect(
            SessionCalendar.effectiveLocalIsoDate(previousDayComplete: false, now: elevenFiftyNine, calendar: calendar) == "2026-10-07",
            "11:59pm unfinished day credits today"
        )
        #expect(
            SessionCalendar.effectiveLocalIsoDate(previousDayComplete: false, now: twelveThirty, calendar: calendar) == "2026-10-07",
            "12:30am unfinished day credits yesterday"
        )
        #expect(
            SessionCalendar.effectiveLocalIsoDate(previousDayComplete: true, now: twelveThirty, calendar: calendar) == "2026-10-08",
            "12:30am finished day credits the new day"
        )
        #expect(
            SessionCalendar.effectiveLocalIsoDate(previousDayComplete: false, now: sixAm, calendar: calendar) == "2026-10-08",
            "6:00am credits the new day"
        )
    }

    @Test func testTwoADayStaysOpenUntilBothSitsAreDone() {
        let primary = SessionCalendar.PracticeDaySit(completed: true, isStandard: true, sessionDate: "2026-10-07", track: "primary")
        let second = SessionCalendar.PracticeDaySit(completed: true, isStandard: true, sessionDate: "2026-10-07", track: "second")
        #expect(!SessionCalendar.isDayComplete(sits: [primary], isoDay: "2026-10-07", dualTrackEnabled: true))
        #expect(SessionCalendar.isDayComplete(sits: [primary, second], isoDay: "2026-10-07", dualTrackEnabled: true))
        #expect(SessionCalendar.isDayComplete(sits: [primary], isoDay: "2026-10-07", dualTrackEnabled: false))
    }
}

// MARK: - #896 combined sit

extension HistoryJourneyTests {
    /// A combined sit counts for both tracks, so it alone finishes a two-a-day day.
    @Test func testCombinedSitCompletesATwoADayDay() {
        let combined = SessionCalendar.PracticeDaySit(
            completed: true, isStandard: true, sessionDate: "2026-10-07", track: "primary", combined: true
        )
        #expect(SessionCalendar.isDayComplete(sits: [combined], isoDay: "2026-10-07", dualTrackEnabled: true))
        #expect(SessionCalendar.isDayComplete(sits: [combined], isoDay: "2026-10-07", dualTrackEnabled: false))
        #expect(!SessionCalendar.isDayComplete(sits: [combined], isoDay: "2026-10-08", dualTrackEnabled: true))

        let noTrack = SessionCalendar.PracticeDaySit(
            completed: true, isStandard: true, sessionDate: "2026-10-07", track: nil, combined: true
        )
        #expect(SessionCalendar.isDayComplete(sits: [noTrack], isoDay: "2026-10-07", dualTrackEnabled: true))
    }

    /// One ended early credits nothing; `combined: nil` or false is an ordinary row.
    @Test func testUnfinishedOrNonCombinedRowDoesNotCompleteATwoADayDay() {
        let endedEarly = SessionCalendar.PracticeDaySit(
            completed: false, isStandard: true, sessionDate: "2026-10-07", track: "primary", combined: true
        )
        #expect(!SessionCalendar.isDayComplete(sits: [endedEarly], isoDay: "2026-10-07", dualTrackEnabled: true))
        let plain = SessionCalendar.PracticeDaySit(
            completed: true, isStandard: true, sessionDate: "2026-10-07", track: "primary", combined: false
        )
        #expect(!SessionCalendar.isDayComplete(sits: [plain], isoDay: "2026-10-07", dualTrackEnabled: true))
    }

    /// The before-6:00 grace window closes after a combined sit on the previous day.
    @Test func testGraceWindowClosesAfterACombinedSit() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let now = try #require(calendar.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 2, minute: 30)))

        func row(combined: Bool?) -> SessionDTO {
            SessionDTO(
                id: "g", dayNumber: 30, duration: 1200, completed: true, actualTime: 1200,
                clearPercent: 0, thoughtCount: 0, mindStateLog: nil, sessionDate: "2026-10-26",
                buddySessionId: nil, track: .primary, combined: combined
            )
        }

        let open = WidgetDataStore.practiceInstant(
            forHistory: [row(combined: nil)], dualTrackEnabled: true, now: now, calendar: calendar
        )
        #expect(WidgetDataStore.localDayString(open, calendar: calendar) == "2026-10-26")

        #expect(
            WidgetDataStore.practiceInstant(
                forHistory: [row(combined: true)], dualTrackEnabled: true, now: now, calendar: calendar
            ) == now
        )
        #expect(SessionCalendar.effectiveLocalIsoDate(previousDayComplete: true, now: now, calendar: calendar) == "2026-10-27")
    }
}
