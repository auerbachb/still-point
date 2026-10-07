import XCTest
import StillPointShared

/// #708: AM/PM widget labels are a designation of the long session, not a clock lock.
final class SessionPeriodTests: XCTestCase {
    func testWidgetLabelsAreAMAndPM() {
        XCTAssertEqual(SessionPeriod.am.widgetLabel, "AM")
        XCTAssertEqual(SessionPeriod.pm.widgetLabel, "PM")
    }

    func testLongSessionMorningPutsPrimaryFirst() {
        XCTAssertEqual(
            SessionPeriod.orderedTracks(longSession: .am),
            [.primary, .second]
        )
        XCTAssertEqual(SessionPeriod.period(for: .primary, longSession: .am), .am)
        XCTAssertEqual(SessionPeriod.period(for: .second, longSession: .am), .pm)
    }

    func testLongSessionEveningPutsSecondTrackOnTheMorningRow() {
        XCTAssertEqual(
            SessionPeriod.orderedTracks(longSession: .pm),
            [.second, .primary]
        )
        XCTAssertEqual(SessionPeriod.period(for: .primary, longSession: .pm), .pm)
        XCTAssertEqual(SessionPeriod.period(for: .second, longSession: .pm), .am)
    }

    func testOrderedRowsAreLabeledMorningThenEvening() {
        for longSession in SessionPeriod.allCases {
            let labels = SessionPeriod.orderedTracks(longSession: longSession).map {
                SessionPeriod.period(for: $0, longSession: longSession).widgetLabel
            }
            XCTAssertEqual(labels, ["AM", "PM"])
        }
    }

    func testUserDTODefaultsMissingPeriodToMorning() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":56,"dualTrackEnabled":true,"secondTrackDay":4}
        """.data(using: .utf8)!
        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertEqual(user.longSessionPeriod, .am)
    }

    func testUserDTORoundTripsEveningPeriod() throws {
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
        XCTAssertEqual(decoded.longSessionPeriod, .pm)
    }

    func testWidgetSnapshotRoundTripsEveningPeriod() throws {
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
        XCTAssertEqual(decoded.longSessionPeriod, .pm)
    }

    func testUserDTODecodesEveningPeriod() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":56,"longSessionPeriod":"pm"}
        """.data(using: .utf8)!
        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertEqual(user.longSessionPeriod, .pm)
    }

    func testUnknownPeriodDecodesAsMorning() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":1,"longSessionPeriod":"noon"}
        """.data(using: .utf8)!
        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertEqual(user.longSessionPeriod, .am)
    }

    func testMakeSnapshotCopiesLongSessionPeriod() {
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
        XCTAssertEqual(snapshot.longSessionPeriod, .pm)
        XCTAssertTrue(snapshot.secondDoneToday)
    }
}
