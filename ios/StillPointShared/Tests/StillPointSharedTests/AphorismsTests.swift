import Foundation
import Testing
import StillPointShared

struct AphorismsTests {
    @Test func testAllEntriesHaveNonEmptyTextAndAuthor() {
        #expect(!Aphorisms.all.isEmpty)
        for aphorism in Aphorisms.all {
            #expect(!aphorism.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            #expect(!aphorism.author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    @Test func testForDayIsDeterministic() {
        #expect(Aphorisms.forDay(3) == Aphorisms.forDay(3))
    }

    @Test func testForDayRotatesThroughTheList() {
        let first = Aphorisms.forDay(1)
        let wrapped = Aphorisms.forDay(1 + Aphorisms.all.count)
        #expect(wrapped == first)
    }

    @Test func testForDayClampsNonPositiveInputToDayOne() {
        #expect(Aphorisms.forDay(0) == Aphorisms.forDay(1))
        #expect(Aphorisms.forDay(-5) == Aphorisms.forDay(1))
    }

    @Test func testForDayAlwaysReturnsAValueFromTheContentList() {
        for day in 1...(Aphorisms.all.count * 2) {
            #expect(Aphorisms.all.contains(Aphorisms.forDay(day)))
        }
    }

    // MARK: - Shared cross-platform fixtures (#421)

    // The same day->index golden set is asserted by web aphorismForDay.
    @Test func testSharedAphorismsFixtures() throws {
        let fixture = try SharedFixtures.load("aphorisms.json", as: AphorismsFixture.self)
        #expect(Aphorisms.all.count == fixture.expectedCount)

        for testCase in fixture.cases {
            #expect(Aphorisms.forDay(testCase.day) == Aphorisms.all[testCase.expectedIndex], "day \(testCase.day)")
        }
    }
}
