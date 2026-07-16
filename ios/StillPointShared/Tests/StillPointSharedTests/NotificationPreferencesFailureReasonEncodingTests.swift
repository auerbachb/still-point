import XCTest
@testable import StillPointShared

final class NotificationPreferencesFailureReasonEncodingTests: XCTestCase {
    func testPatchEncodesFailureReasonReminderEnabledWhenSet() throws {
        let patch = NotificationPreferencesPatch(failureReasonReminderEnabled: true)

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(jsonObject["failureReasonReminderEnabled"] as? Bool, true)
        XCTAssertNil(jsonObject["pushEnabled"])
        XCTAssertNil(jsonObject["dailyReminderTime"])
    }

    func testPatchOmitsFailureReasonReminderEnabledWhenNil() throws {
        let patch = NotificationPreferencesPatch(pushEnabled: true)

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertNil(jsonObject["failureReasonReminderEnabled"])
        XCTAssertEqual(jsonObject["pushEnabled"] as? Bool, true)
    }

    func testDTODecodesFailureReasonReminderEnabled() throws {
        let json = """
        {
            "pushEnabled": true,
            "dailyReminderEnabled": false,
            "missADayEnabled": false,
            "friendRequestNotificationsEnabled": true,
            "failureReasonReminderEnabled": true,
            "suppressDuringSession": false,
            "dailyReminderTime": "09:00",
            "dailyReminderFrequency": "daily",
            "quietHoursStart": null,
            "quietHoursEnd": null,
            "tz": "America/New_York",
            "updatedAt": "2026-06-25T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(NotificationPreferencesDTO.self, from: json)

        XCTAssertTrue(dto.failureReasonReminderEnabled)
    }
}
