import XCTest
@testable import StillPointShared

/// #896: `CombinedSit` against the golden fixture the web suite reads
/// (`shared/test-fixtures/combinedSit.json`, #769), so the two apps cannot drift
/// apart on what a combined sit is.
final class CombinedSitTests: XCTestCase {
    private func fixture() throws -> CombinedSitFixture {
        try SharedFixtures.load("combinedSit.json", as: CombinedSitFixture.self)
    }

    func testCombinedDurationMatchesFixture() throws {
        let cases = try fixture().combinedDuration
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            XCTAssertEqual(
                CombinedSit.combinedDuration(currentDay: c.currentDay, secondTrackDay: c.secondTrackDay),
                c.expected,
                c.name
            )
        }
    }

    func testIsCombineOfferedMatchesFixture() throws {
        let cases = try fixture().isCombineOffered
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            XCTAssertEqual(
                CombinedSit.isCombineOffered(
                    dualTrackEnabled: c.dualTrackEnabled,
                    primaryDoneToday: c.primaryDoneToday,
                    secondDoneToday: c.secondDoneToday,
                    recoveryActive: c.recoveryActive
                ),
                c.expected,
                c.name
            )
        }
    }

    func testTracksCreditedMatchesFixture() throws {
        let cases = try fixture().tracksCredited
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let track = c.track.flatMap(Track.init(rawValue:))
            if c.track != nil { XCTAssertNotNil(track, "\(c.name): unknown track in fixture") }
            let credited = CombinedSit.tracksCredited(track: track, combined: c.combined)
            XCTAssertEqual(
                credited,
                CombinedSit.TracksCredited(primary: c.expected.primary, second: c.expected.second),
                c.name
            )
        }
    }

    /// The session overload reads the row's own `track` and `combined`.
    func testTracksCreditedForASessionRow() {
        func row(track: Track?, combined: Bool?) -> SessionDTO {
            SessionDTO(
                id: "s", dayNumber: 1, duration: 60, completed: true, actualTime: 60,
                clearPercent: 0, thoughtCount: 0, mindStateLog: nil, sessionDate: "2026-10-27",
                buddySessionId: nil, track: track, combined: combined
            )
        }
        XCTAssertEqual(CombinedSit.tracksCredited(row(track: .primary, combined: true)),
                       CombinedSit.TracksCredited(primary: true, second: true))
        XCTAssertEqual(CombinedSit.tracksCredited(row(track: nil, combined: nil)),
                       CombinedSit.TracksCredited(primary: true, second: false))
        XCTAssertEqual(CombinedSit.tracksCredited(row(track: .second, combined: false)),
                       CombinedSit.TracksCredited(primary: false, second: true))
    }

    /// A completed combined sit moves both tracks on a day; one ended early moves
    /// neither, so the preview is today's combined length again.
    func testPreviewNextCombinedDuration() {
        XCTAssertEqual(
            CombinedSit.previewNextCombinedDuration(completed: true, currentDay: 45, secondTrackDay: 10),
            CombinedSit.combinedDuration(currentDay: 46, secondTrackDay: 11)
        )
        XCTAssertEqual(
            CombinedSit.previewNextCombinedDuration(completed: false, currentDay: 45, secondTrackDay: 10),
            650
        )
        // Both at the cap: another day adds nothing.
        XCTAssertEqual(
            CombinedSit.previewNextCombinedDuration(completed: true, currentDay: 55, secondTrackDay: 55),
            1200
        )
    }
}
