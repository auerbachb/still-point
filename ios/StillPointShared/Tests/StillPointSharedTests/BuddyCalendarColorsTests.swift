import XCTest
@testable import StillPointShared

final class BuddyCalendarColorsTests: XCTestCase {
    func testStableColorForSameUserId() {
        let id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        XCTAssertEqual(buddyColorIndexFromUserId(id), buddyColorIndexFromUserId(id))
    }

    func testKnownFixtureIndices() {
        // Hardcoded expected indices for stability — computed from the djb2-style hash mod 8.
        // These pin the exact algorithm; update here if the hash function intentionally changes.
        XCTAssertEqual(buddyColorIndexFromUserId("00000000-0000-4000-8000-000000000001"), 5)
        XCTAssertEqual(buddyColorIndexFromUserId("00000000-0000-4000-8000-000000000002"), 6)
        XCTAssertEqual(buddyColorIndexFromUserId("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), 4)
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
