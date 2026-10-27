import Foundation
import Testing
import StillPointShared

/// #708: AM/PM widget labels are a designation of the long session, not a clock lock.
struct SessionPeriodTests {
    @Test func testWidgetLabelsAreAMAndPM() {
        #expect(SessionPeriod.am.widgetLabel == "AM")
        #expect(SessionPeriod.pm.widgetLabel == "PM")
    }

    @Test func testLongSessionMorningPutsPrimaryFirst() {
        #expect(SessionPeriod.orderedTracks(longSession: .am) == [.primary, .second])
        #expect(SessionPeriod.period(for: .primary, longSession: .am) == .am)
        #expect(SessionPeriod.period(for: .second, longSession: .am) == .pm)
    }

    @Test func testLongSessionEveningPutsSecondTrackOnTheMorningRow() {
        #expect(SessionPeriod.orderedTracks(longSession: .pm) == [.second, .primary])
        #expect(SessionPeriod.period(for: .primary, longSession: .pm) == .pm)
        #expect(SessionPeriod.period(for: .second, longSession: .pm) == .am)
    }

    @Test func testOrderedRowsAreLabeledMorningThenEvening() {
        for longSession in SessionPeriod.allCases {
            let labels = SessionPeriod.orderedTracks(longSession: longSession).map {
                SessionPeriod.period(for: $0, longSession: longSession).widgetLabel
            }
            #expect(labels == ["AM", "PM"])
        }
    }

    @Test func testUserDTODefaultsMissingPeriodToMorning() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":56,"dualTrackEnabled":true,"secondTrackDay":4}
        """.data(using: .utf8)!
        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.longSessionPeriod == .am)
    }

    @Test func testUserDTORoundTripsEveningPeriod() throws {
        let user = UserDTO(
            id: "u1",
            email: "a@b.com",
            username: "alice",
            isPublic: false,
            currentDay: 12,
            longSessionPeriod: .pm
        )
        let data = try JSONEncoder().encode(user)
        let decoded = try JSONDecoder().decode(UserDTO.self, from: data)
        #expect(decoded.longSessionPeriod == .pm)
    }

    @Test func testWidgetSnapshotRoundTripsEveningPeriod() throws {
        let snapshot = WidgetData(
            isLoggedIn: true,
            userId: "u1",
            currentDay: 12,
            secondTrackDay: 3,
            dualTrackEnabled: true,
            longSessionPeriod: .pm,
            primaryDoneToday: false,
            secondDoneToday: false,
            streak: 1,
            lastUpdated: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let data = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(WidgetData.self, from: data)
        #expect(decoded.longSessionPeriod == .pm)
    }

    @Test func testUserDTODecodesEveningPeriod() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":56,"longSessionPeriod":"pm"}
        """.data(using: .utf8)!
        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.longSessionPeriod == .pm)
    }

    @Test func testUnknownPeriodDecodesAsMorning() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":1,"longSessionPeriod":"noon"}
        """.data(using: .utf8)!
        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.longSessionPeriod == .am)
    }

    @Test func testMakeSnapshotCopiesLongSessionPeriod() {
        let user = UserDTO(
            id: "user-1",
            email: "a@b.com",
            username: "alice",
            isPublic: false,
            currentDay: 12,
            dualTrackEnabled: true,
            longSessionPeriod: .pm
        )
        let snapshot = WidgetDataStore.makeSnapshot(
            user: user,
            primaryDoneToday: false,
            secondDoneToday: true,
            practiceDoneToday: false
        )
        #expect(snapshot.longSessionPeriod == .pm)
        #expect(snapshot.secondDoneToday)
    }
}
