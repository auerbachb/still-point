import XCTest
import StillPointShared

final class UserDTOTests: XCTestCase {
    func testDecodesAphorismsEnabledWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3,"aphorismsEnabled":true}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertTrue(user.aphorismsEnabled)
    }

    /// #88 shipped as an additive field; a server or cached fixture that predates
    /// it must still decode, defaulting the toggle to off.
    func testDefaultsAphorismsEnabledToFalseWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertFalse(user.aphorismsEnabled)
    }

    func testRoundTripsThroughEncodeAndDecode() throws {
        let user = UserDTO(
            id: "u1",
            email: "a@b.com",
            username: "alice",
            isPublic: true,
            currentDay: 5,
            aphorismsEnabled: true
        )
        let data = try JSONEncoder().encode(user)
        let decoded = try JSONDecoder().decode(UserDTO.self, from: data)
        XCTAssertEqual(decoded.aphorismsEnabled, true)
        XCTAssertEqual(decoded.id, user.id)
    }

    // MARK: - #240 dual-track fields

    func testDecodesDualTrackFieldsWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":56,"dualTrackEnabled":true,"secondTrackDay":4}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertTrue(user.dualTrackEnabled)
        XCTAssertEqual(user.secondTrackDay, 4)
    }

    /// #240 shipped as additive fields; a server/fixture that predates them must
    /// still decode, defaulting to single-track (disabled, day 1).
    func testDefaultsDualTrackFieldsWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertFalse(user.dualTrackEnabled)
        XCTAssertEqual(user.secondTrackDay, 1)
    }
}
