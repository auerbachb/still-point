import XCTest
@testable import StillPointShared

final class BuddyCalendarColorsTests: XCTestCase {
    func testStableColorForSameUserId() {
        let id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        XCTAssertEqual(buddyColorIndexFromUserId(id), buddyColorIndexFromUserId(id))
    }

    func testDifferentColorsForDifferentUserIds() {
        let a = "00000000-0000-4000-8000-000000000001"
        let b = "00000000-0000-4000-8000-000000000002"
        XCTAssertNotEqual(buddyColorIndexFromUserId(a), buddyColorIndexFromUserId(b))
    }

    func testPaletteHasEightEntries() {
        XCTAssertEqual(BUDDY_CALENDAR_PALETTE.count, 8)
    }

    func testIndexInPaletteBounds() {
        let id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        let index = buddyColorIndexFromUserId(id)
        XCTAssertGreaterThanOrEqual(index, 0)
        XCTAssertLessThan(index, BUDDY_CALENDAR_PALETTE.count)
    }
}
