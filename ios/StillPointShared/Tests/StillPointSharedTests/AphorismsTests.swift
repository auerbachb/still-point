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
}
