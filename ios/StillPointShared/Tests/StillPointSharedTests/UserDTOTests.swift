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
}
