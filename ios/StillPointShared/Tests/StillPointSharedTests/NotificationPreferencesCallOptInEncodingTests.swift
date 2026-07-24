import XCTest
@testable import StillPointShared

final class NotificationPreferencesCallOptInEncodingTests: XCTestCase {
    func testPatchEncodesCallOptInFieldsWhenSet() throws {
        let patch = NotificationPreferencesPatch(
            callOptIn: true,
            callPhoneNumber: .some("+15551234567"),
            callWindowStart: .some("18:00"),
            callWindowStop: .some("21:00")
        )

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(jsonObject["callOptIn"] as? Bool, true)
        XCTAssertEqual(jsonObject["callPhoneNumber"] as? String, "+15551234567")
        XCTAssertEqual(jsonObject["callWindowStart"] as? String, "18:00")
        XCTAssertEqual(jsonObject["callWindowStop"] as? String, "21:00")
    }

    func testDTODecodesCallOptInFields() throws {
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

        XCTAssertTrue(dto.callOptIn)
        XCTAssertEqual(dto.callPhoneNumber, "+15551234567")
        XCTAssertEqual(dto.callWindowStart, "18:00")
        XCTAssertEqual(dto.callWindowStop, "21:00")
    }
}
