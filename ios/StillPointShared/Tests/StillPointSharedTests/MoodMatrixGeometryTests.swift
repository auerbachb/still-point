import XCTest
import StillPointShared

/// #911 — the recap's Mood shift grid was wider than an iPhone's column, so on
/// narrow screens it stacks BEFORE above AFTER. `CompletionView` lets
/// `ViewThatFits` pick between the two layouts from these widths; these tests
/// pin the arithmetic that decides which iPhones get which one. #964 raised the
/// cells to 44 × 44 and moved the stacked phase labels above their scales.
final class MoodMatrixGeometryTests: XCTestCase {

    /// `CompletionView` pads the recap by `SPSpacing.s4` (24pt) on each side.
    private let recapPadding = 24.0

    private func columnWidth(onScreenWidth screenWidth: Double) -> Double {
        screenWidth - 2 * recapPadding
    }

    func testRowWidthsAddUpFromTheCellsLabelsAndSpacing() {
        XCTAssertEqual(MoodMatrixGeometry.scaleWidth, 232)
        XCTAssertEqual(MoodMatrixGeometry.wideWidth, 548)
        XCTAssertEqual(MoodMatrixGeometry.stackedWidth, 232)
    }

    /// #964's design call: every cell is a 44 × 44 tap target in both layouts.
    func testCellsAreFortyFourPointTapTargets() {
        XCTAssertGreaterThanOrEqual(MoodMatrixGeometry.cellSize, 44)
    }

    /// The acceptance criterion: on a 375pt iPhone (a 327pt column) every
    /// cell is visible. The wide grid does not fit there; the stacked one does.
    func testA375PointIPhoneGetsTheStackedLayoutAndItFits() {
        let column = columnWidth(onScreenWidth: 375)

        XCTAssertLessThan(column, MoodMatrixGeometry.wideWidth)
        XCTAssertLessThanOrEqual(MoodMatrixGeometry.stackedWidth, column)
    }

    /// Only a column of 548pt or more holds the wide grid, so every current
    /// iPhone, the 440pt Pro Max included, stacks.
    func testEveryIPhoneStacks() {
        for screenWidth in [375.0, 390, 393, 402, 414, 428, 430, 440] {
            let column = columnWidth(onScreenWidth: screenWidth)
            XCTAssertLessThan(column, MoodMatrixGeometry.wideWidth, "\(screenWidth)pt should stack")
            XCTAssertLessThanOrEqual(MoodMatrixGeometry.stackedWidth, column, "\(screenWidth)pt should fit stacked")
        }
    }

    /// A tablet-width column (a 768pt iPad portrait) still holds the wide grid.
    func testATabletWidthHoldsTheWideGrid() {
        XCTAssertGreaterThanOrEqual(columnWidth(onScreenWidth: 768), MoodMatrixGeometry.wideWidth)
    }
}
