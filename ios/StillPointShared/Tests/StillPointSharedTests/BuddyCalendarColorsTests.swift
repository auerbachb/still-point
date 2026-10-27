import Foundation
import Testing
@testable import StillPointShared

struct BuddyCalendarColorsTests {
    @Test func testStableColorForSameUserId() {
        let id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        #expect(buddyColorIndexFromUserId(id) == buddyColorIndexFromUserId(id))
    }

    @Test func testKnownFixtureIndices() {
        // Hardcoded expected indices for stability — computed from the djb2-style hash mod 8.
        // These pin the exact algorithm; update here if the hash function intentionally changes.
        #expect(buddyColorIndexFromUserId("00000000-0000-4000-8000-000000000001") == 5)
        #expect(buddyColorIndexFromUserId("00000000-0000-4000-8000-000000000002") == 6)
        #expect(buddyColorIndexFromUserId("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11") == 4)
    }

    @Test func testPaletteHasEightEntries() {
        #expect(BUDDY_CALENDAR_PALETTE.count == 8)
    }

    @Test func testIndexInPaletteBounds() {
        let id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        let index = buddyColorIndexFromUserId(id)
        #expect(index >= 0)
        #expect(index < BUDDY_CALENDAR_PALETTE.count)
    }

    // MARK: - Shared cross-platform fixtures (#421)

    // The same user-id -> palette index/hex golden set is asserted by web
    // buddyColorFromUserId (which returns the hex). Pins exact indices so any
    // hash/palette drift breaks CI on either platform.
    @Test func testSharedBuddyCalendarColorsFixtures() throws {
        let fixture = try SharedFixtures.load("buddyCalendarColors.json", as: BuddyCalendarColorsFixture.self)
        #expect(BUDDY_CALENDAR_PALETTE.count == fixture.paletteLength)
        #expect(BUDDY_CALENDAR_PALETTE == fixture.palette)

        for testCase in fixture.cases {
            #expect(buddyColorIndexFromUserId(testCase.userId) == testCase.expectedIndex, Comment(rawValue: testCase.userId))
            #expect(BUDDY_CALENDAR_PALETTE[testCase.expectedIndex] == testCase.expectedHex, Comment(rawValue: testCase.userId))
        }
    }
}
