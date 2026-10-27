import Foundation
import Testing
@testable import StillPointShared

struct NotificationPreferencesCallOptInEncodingTests {
    @Test func testPatchEncodesCallOptInFieldsWhenSet() throws {
        let patch = NotificationPreferencesPatch(
            callOptIn: true,
            callPhoneNumber: .some("+15551234567"),
            callWindowStart: .some("18:00"),
            callWindowStop: .some("21:00")
        )

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((jsonObject["callOptIn"] as? Bool) == true)
        #expect((jsonObject["callPhoneNumber"] as? String) == "+15551234567")
        #expect((jsonObject["callWindowStart"] as? String) == "18:00")
        #expect((jsonObject["callWindowStop"] as? String) == "21:00")
    }

    @Test func testDTODecodesCallOptInFields() throws {
        let json = """
        {
            "pushEnabled": true,
            "dailyReminderEnabled": false,
            "missADayEnabled": false,
            "friendRequestNotificationsEnabled": true,
            "failureReasonReminderEnabled": false,
            "suppressDuringSession": false,
            "dailyReminderTime": "09:00",
            "dailyReminderFrequency": "daily",
            "quietHoursStart": null,
            "quietHoursEnd": null,
            "callOptIn": true,
            "callPhoneNumber": "+15551234567",
            "callConsentAt": "2026-06-25T12:00:00.000Z",
            "callWindowStart": "18:00",
            "callWindowStop": "21:00",
            "tz": "America/New_York",
            "updatedAt": "2026-06-25T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(NotificationPreferencesDTO.self, from: json)

        #expect(dto.callOptIn)
        #expect(dto.callPhoneNumber == "+15551234567")
        #expect(dto.callWindowStart == "18:00")
        #expect(dto.callWindowStop == "21:00")
    }
}
