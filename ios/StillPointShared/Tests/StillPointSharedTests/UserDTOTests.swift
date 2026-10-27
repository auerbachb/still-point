import Foundation
import Testing
@testable import StillPointShared

struct UserDTOTests {
    @Test func testDecodesAphorismsEnabledWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3,"aphorismsEnabled":true}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.aphorismsEnabled)
    }

    /// #88 shipped as an additive field; a server or cached fixture that predates
    /// it must still decode, defaulting the toggle to off.
    @Test func testDefaultsAphorismsEnabledToFalseWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(!user.aphorismsEnabled)
    }

    @Test func testRoundTripsThroughEncodeAndDecode() throws {
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
        #expect(decoded.aphorismsEnabled == true)
        #expect(decoded.id == user.id)
    }

    // MARK: - #240 dual-track fields

    @Test func testDecodesDualTrackFieldsWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":56,"dualTrackEnabled":true,"secondTrackDay":4}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.dualTrackEnabled)
        #expect(user.secondTrackDay == 4)
    }

    /// #240 shipped as additive fields; a server/fixture that predates them must
    /// still decode, defaulting to single-track (disabled, day 1).
    @Test func testDefaultsDualTrackFieldsWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(!user.dualTrackEnabled)
        #expect(user.secondTrackDay == 1)
    }

    // MARK: - #238 recovery fields

    @Test func testDecodesRecoveryFieldsWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":45,"recoveryTargetDay":45,"recoveryCurrentStep":3,"recoveryTotalSteps":5}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.recoveryTargetDay == 45)
        #expect(user.recoveryCurrentStep == 3)
        #expect(user.recoveryTotalSteps == 5)
    }

    @Test func testDefaultsRecoveryFieldsToNilWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.recoveryTargetDay == nil)
        #expect(user.recoveryCurrentStep == nil)
        #expect(user.recoveryTotalSteps == nil)
    }

    // MARK: - #839 focus goal counter

    @Test func testDecodesFocusActivityDayWhenPresent() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":12,"focusActivityDay":31}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.focusActivityDay == 31)
        #expect(user.currentDay == 12)
    }

    /// A server that predates #765, or an identity cached before #839, has no
    /// `focusActivityDay`; it must still decode, starting the focus goal at day 1.
    @Test func testDefaultsFocusActivityDayToOneWhenMissing() throws {
        let json = """
        {"id":"u1","email":"a@b.com","username":"alice","isPublic":false,"currentDay":3}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(UserDTO.self, from: json)
        #expect(user.focusActivityDay == 1)
        #expect(UserDTO(id: "u1", email: "a@b.com", username: "alice", isPublic: false, currentDay: 3).focusActivityDay == 1)
    }

    /// `CachedIdentityStore` and the UI-test store persist the whole user by encoding it.
    @Test func testFocusActivityDayRoundTripsThroughEncodeAndDecode() throws {
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
        #expect(decoded.focusActivityDay == 42)
    }

    @Test func testUpdatingSetsFocusActivityDayAndOtherwiseKeepsIt() {
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
        #expect(stepped.focusActivityDay == 8)
        #expect(stepped.currentDay == 5)
        #expect(stepped.secondTrackDay == 3)

        #expect(user.updating(username: "bob").focusActivityDay == 7)
        #expect(user.updating(secondTrackDay: 4).focusActivityDay == 7)
    }

    /// Both rebuild the whole user; neither may reset the focus goal to its default.
    @Test func testProgressionAndRecoveryUpdatesKeepFocusActivityDay() {
        let user = UserDTO(
            id: "u1",
            email: "a@b.com",
            username: "alice",
            isPublic: false,
            currentDay: 20,
            focusActivityDay: 9
        )

        let progressed = user.updatingProgression(DurationRecovery.ProgressionState(currentDay: 21))
        #expect(progressed.currentDay == 21)
        #expect(progressed.focusActivityDay == 9)

        let recovering = user.updatingRecovery(targetDay: 20, currentStep: 1, totalSteps: 5)
        #expect(recovering.recoveryTargetDay == 20)
        #expect(recovering.focusActivityDay == 9)
    }
}
