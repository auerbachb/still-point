import XCTest
import StillPointShared

/// #911 — the recap's Mood shift grid was wider than an iPhone's column, so on
/// narrow screens it stacks BEFORE above AFTER. `CompletionView` lets
/// `ViewThatFits` pick between the two layouts from these widths; these tests
/// pin the arithmetic that decides which iPhones get which one.
final class MoodMatrixGeometryTests: XCTestCase {

    /// `CompletionView` pads the recap by `SPSpacing.s4` (24pt) on each side.
    private let recapPadding = 24.0

    private func columnWidth(onScreenWidth screenWidth: Double) -> Double {
        screenWidth - 2 * recapPadding
    }

    func testRowWidthsAddUpFromTheCellsLabelsAndSpacing() {
        XCTAssertEqual(MoodMatrixGeometry.scaleWidth, 152)
        XCTAssertEqual(MoodMatrixGeometry.wideWidth, 388)
        XCTAssertEqual(MoodMatrixGeometry.stackedWidth, 212)
    }

    /// The design call: the cells stay 28 × 28, the minimum tap target, in both layouts.
    func testCellsKeepTheTwentyEightPointTapTarget() {
        XCTAssertGreaterThanOrEqual(MoodMatrixGeometry.cellSize, 28)
    }

    /// The acceptance criterion: on a 375pt iPhone (a 327pt column) every
    /// cell is visible. The wide grid does not fit there; the stacked one does.
    func testA375PointIPhoneGetsTheStackedLayoutAndItFits() {
        let column = columnWidth(onScreenWidth: 375)

        XCTAssertLessThan(column, MoodMatrixGeometry.wideWidth)
        XCTAssertLessThanOrEqual(MoodMatrixGeometry.stackedWidth, column)
    }

    /// Only a column of 388pt or more holds the wide grid. Among current
    /// iPhones that is the 440pt Pro Max; every other width stacks.
    func testOnlyTheWidestIPhoneHoldsTheWideGrid() {
        for screenWidth in [375.0, 390, 393, 402, 414, 428, 430] {
            let column = columnWidth(onScreenWidth: screenWidth)
            XCTAssertLessThan(column, MoodMatrixGeometry.wideWidth, "\(screenWidth)pt should stack")
            XCTAssertLessThanOrEqual(MoodMatrixGeometry.stackedWidth, column, "\(screenWidth)pt should fit stacked")
        }
        XCTAssertGreaterThanOrEqual(columnWidth(onScreenWidth: 440), MoodMatrixGeometry.wideWidth)
    }
}
