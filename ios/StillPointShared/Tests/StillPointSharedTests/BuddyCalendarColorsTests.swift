import XCTest
@testable import StillPointShared

final class BuddyCalendarColorsTests: XCTestCase {
    func testStableColorForSameUserId() {
        let id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        let a = buddyColorHexFromUserId(id)
        let b = buddyColorHexFromUserId(id)
        XCTAssertEqual(a, b)
    }

    func testDifferentColorsForDifferentUserIds() {
        let a = "00000000-0000-4000-8000-000000000001"
        let b = "00000000-0000-4000-8000-000000000002"
        XCTAssertNotEqual(buddyColorHexFromUserId(a), buddyColorHexFromUserId(b))
    }

    func testPaletteHasEightEntries() {
        XCTAssertEqual(BUDDY_CALENDAR_PALETTE.count, 8)
    }
}

/// Compare palette indices without depending on SwiftUI `Color` equality.
private func buddyColorHexFromUserId(_ userId: String) -> String {
    var hash: UInt32 = 0
    for byte in userId.utf8 {
        hash = hash &* 31 &+ UInt32(byte)
    }
    let index = Int(hash % UInt32(BUDDY_CALENDAR_PALETTE.count))
    return BUDDY_CALENDAR_PALETTE[index]
}
