import XCTest
import StillPointShared

final class AphorismsTests: XCTestCase {
    func testAllEntriesHaveNonEmptyTextAndAuthor() {
        XCTAssertFalse(Aphorisms.all.isEmpty)
        for aphorism in Aphorisms.all {
            XCTAssertFalse(aphorism.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertFalse(aphorism.author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    func testForDayIsDeterministic() {
        XCTAssertEqual(Aphorisms.forDay(3), Aphorisms.forDay(3))
    }

    func testForDayRotatesThroughTheList() {
        let first = Aphorisms.forDay(1)
        let wrapped = Aphorisms.forDay(1 + Aphorisms.all.count)
        XCTAssertEqual(wrapped, first)
    }

    func testForDayClampsNonPositiveInputToDayOne() {
        XCTAssertEqual(Aphorisms.forDay(0), Aphorisms.forDay(1))
        XCTAssertEqual(Aphorisms.forDay(-5), Aphorisms.forDay(1))
    }

    func testForDayAlwaysReturnsAValueFromTheContentList() {
        for day in 1...(Aphorisms.all.count * 2) {
            XCTAssertTrue(Aphorisms.all.contains(Aphorisms.forDay(day)))
        }
    }

    // MARK: - Shared cross-platform fixtures (#421)

    // The same day->index golden set is asserted by web aphorismForDay.
    func testSharedAphorismsFixtures() throws {
        let fixture = try SharedFixtures.load("aphorisms.json", as: AphorismsFixture.self)
        XCTAssertEqual(Aphorisms.all.count, fixture.expectedCount)

        for testCase in fixture.cases {
            XCTAssertEqual(Aphorisms.forDay(testCase.day), Aphorisms.all[testCase.expectedIndex], "day \(testCase.day)")
        }
    }
}
