import Foundation

/// #911: widths of the recap's Mood shift grid, in points.
///
/// A scale is one mood's five tap cells for one side, before or after. The
/// wide grid puts a mood's label and both of its scales on one row. Where that
/// row is wider than the column, the recap stacks BEFORE above AFTER under each
/// mood label instead, each phase label on the line above its scale (#964).
/// `CompletionView` builds both layouts from these numbers and lets
/// `ViewThatFits` choose: it shows the wide grid only when the column is at
/// least `wideWidth`.
///
/// Web builds the same two layouts in `src/components/MoodMatrix.tsx`, with a
/// 6px column gap, so its widths are 544px and 232px.
///
/// Free of SwiftUI / UIKit so it compiles and runs under `swift test` on macOS.
public enum MoodMatrixGeometry {
    /// A tap cell's side. #964: 44pt, Apple's minimum tap target, in every
    /// layout (#911 had 28): the stacked layout rearranges the cells, it never
    /// shrinks them.
    public static let cellSize: Double = 44
    public static let cellSpacing: Double = 3
    /// #885: HAPPINESS measures 64.6pt in the label font (SF Mono 10pt medium,
    /// 1pt tracking); 68pt holds it on one line.
    public static let labelWidth: Double = 68
    /// Between a label and the scale next to it (`SPSpacing.s1`).
    public static let columnSpacing: Double = 8

    /// Five cells and the four gaps between them: 232pt. The column headers and
    /// the low/high hints take this width too, so they line up with the cells.
    public static let scaleWidth = 5 * cellSize + 4 * cellSpacing
    /// A wide row, the label and both scales: 548pt.
    public static let wideWidth = labelWidth + 2 * columnSpacing + 2 * scaleWidth
    /// A stacked block, one scale wide: 232pt. #964: its BEFORE / AFTER labels
    /// sit above the scales, so they add no width; beside them the row would
    /// be 292pt.
    public static let stackedWidth = scaleWidth
}
