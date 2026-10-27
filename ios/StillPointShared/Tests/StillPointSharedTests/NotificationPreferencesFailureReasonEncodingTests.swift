import Foundation
import Testing
@testable import StillPointShared

struct NotificationPreferencesFailureReasonEncodingTests {
    @Test func testPatchEncodesFailureReasonReminderEnabledWhenSet() throws {
        let patch = NotificationPreferencesPatch(failureReasonReminderEnabled: true)

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((jsonObject["failureReasonReminderEnabled"] as? Bool) == true)
        #expect(jsonObject["pushEnabled"] == nil)
        #expect(jsonObject["dailyReminderTime"] == nil)
    }

    @Test func testPatchOmitsFailureReasonReminderEnabledWhenNil() throws {
        let patch = NotificationPreferencesPatch(pushEnabled: true)

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect(jsonObject["failureReasonReminderEnabled"] == nil)
        #expect((jsonObject["pushEnabled"] as? Bool) == true)
    }

    @Test func testDTODecodesFailureReasonReminderEnabled() throws {
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

        #expect(dto.failureReasonReminderEnabled)
    }
}
