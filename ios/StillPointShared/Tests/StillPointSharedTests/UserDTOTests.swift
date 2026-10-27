import XCTest
@testable import StillPointShared

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

    // MARK: - #238 recovery fields

    func testDecodesRecoveryFieldsWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":45,"recoveryTargetDay":45,"recoveryCurrentStep":3,"recoveryTotalSteps":5}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertEqual(user.recoveryTargetDay, 45)
        XCTAssertEqual(user.recoveryCurrentStep, 3)
        XCTAssertEqual(user.recoveryTotalSteps, 5)
    }

    func testDefaultsRecoveryFieldsToNilWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertNil(user.recoveryTargetDay)
        XCTAssertNil(user.recoveryCurrentStep)
        XCTAssertNil(user.recoveryTotalSteps)
    }

    // MARK: - #839 focus goal counter

    func testDecodesFocusActivityDayWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":12,"focusActivityDay":31}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertEqual(user.focusActivityDay, 31)
        XCTAssertEqual(user.currentDay, 12)
    }

    /// A server that predates #765, or an identity cached before #839, has no
    /// `focusActivityDay`; it must still decode, starting the focus goal at day 1.
    func testDefaultsFocusActivityDayToOneWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        XCTAssertEqual(user.focusActivityDay, 1)
        XCTAssertEqual(UserDTO(id: "u1", email: "a@b.com", username: "alice", isPublic: false, currentDay: 3).focusActivityDay, 1)
    }

    /// `CachedIdentityStore` and the UI-test store persist the whole user by encoding it.
    func testFocusActivityDayRoundTripsThroughEncodeAndDecode() throws {
        let user = UserDTO(
            id: "u1",
            email: "a@b.com",
            username: "alice",
            isPublic: false,
            currentDay: 5,
            focusActivityDay: 42
        )
        let data = try JSONEncoder().encode(user)
        let decoded = try JSONDecoder().decode(UserDTO.self, from: data)
        XCTAssertEqual(decoded.focusActivityDay, 42)
    }

    func testUpdatingSetsFocusActivityDayAndOtherwiseKeepsIt() {
        let user = UserDTO(
            id: "u1",
            email: "a@b.com",
            username: "alice",
            isPublic: false,
            currentDay: 5,
            secondTrackDay: 3,
            focusActivityDay: 7
        )

        let stepped = user.updating(focusActivityDay: 8)
        XCTAssertEqual(stepped.focusActivityDay, 8)
        XCTAssertEqual(stepped.currentDay, 5)
        XCTAssertEqual(stepped.secondTrackDay, 3)

        XCTAssertEqual(user.updating(username: "bob").focusActivityDay, 7)
        XCTAssertEqual(user.updating(secondTrackDay: 4).focusActivityDay, 7)
    }

    /// Both rebuild the whole user; neither may reset the focus goal to its default.
    func testProgressionAndRecoveryUpdatesKeepFocusActivityDay() {
        let user = UserDTO(
            id: "u1",
            email: "a@b.com",
            username: "alice",
            isPublic: false,
            currentDay: 20,
            focusActivityDay: 9
        )

        let progressed = user.updatingProgression(DurationRecovery.ProgressionState(currentDay: 21))
        XCTAssertEqual(progressed.currentDay, 21)
        XCTAssertEqual(progressed.focusActivityDay, 9)

        let recovering = user.updatingRecovery(targetDay: 20, currentStep: 1, totalSteps: 5)
        XCTAssertEqual(recovering.recoveryTargetDay, 20)
        XCTAssertEqual(recovering.focusActivityDay, 9)
    }
}
