import XCTest
@testable import StillPointShared

final class NotificationPreferencesSuppressionEncodingTests: XCTestCase {
    func testPatchEncodesSuppressDuringSessionWhenSet() throws {
        let patch = NotificationPreferencesPatch(suppressDuringSession: true)

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(jsonObject["suppressDuringSession"] as? Bool, true)
        // Other fields must stay absent so PATCH only touches the toggled field.
        XCTAssertNil(jsonObject["pushEnabled"])
        XCTAssertNil(jsonObject["dailyReminderTime"])
    }

    func testPatchOmitsSuppressDuringSessionWhenNil() throws {
        let patch = NotificationPreferencesPatch(pushEnabled: true)

        let data = try JSONEncoder().encode(patch)
        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertNil(jsonObject["suppressDuringSession"])
        XCTAssertEqual(jsonObject["pushEnabled"] as? Bool, true)
    }

    func testDTODecodesSuppressDuringSession() throws {
        let json = """
        {
            "pushEnabled": true,
            "dailyReminderEnabled": false,
            "missADayEnabled": false,
            "friendRequestNotificationsEnabled": true,
            "suppressDuringSession": true,
            "dailyReminderTime": "09:00",
            "dailyReminderFrequency": "daily",
            "quietHoursStart": null,
            "quietHoursEnd": null,
            "tz": "America/New_York",
            "updatedAt": "2026-06-25T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(NotificationPreferencesDTO.self, from: json)

        XCTAssertTrue(dto.suppressDuringSession)
    }
}
