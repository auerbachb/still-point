import Foundation

/// #911: widths of the recap's Mood shift grid, in points.
///
/// A scale is one mood's five tap cells for one side, before or after. The
/// wide grid puts a mood's label and both of its scales on one row. Where that
/// row is wider than the column, the recap stacks BEFORE above AFTER under each
/// mood label instead, so each row is a phase label and one scale.
/// `CompletionView` builds both layouts from these numbers and lets
/// `ViewThatFits` choose: it shows the wide grid only when the column is at
/// least `wideWidth`.
///
/// Web builds the same two layouts in `src/components/MoodMatrix.tsx`, with a
/// 6px column gap, so its widths are 384px and 210px.
///
/// Free of SwiftUI / UIKit so it compiles and runs under `swift test` on macOS.
public enum MoodMatrixGeometry {
    /// A tap cell's side. #911 keeps it as the grid's minimum tap target in
    /// every layout: the stacked layout rearranges the cells, it never
    /// shrinks them.
    public static let cellSize: Double = 28
    public static let cellSpacing: Double = 3
    /// #885: HAPPINESS measures 64.6pt in the label font (SF Mono 10pt medium,
    /// 1pt tracking); 68pt holds it on one line.
    public static let labelWidth: Double = 68
    /// Between a label and the scale next to it (`SPSpacing.s1`).
    public static let columnSpacing: Double = 8
    /// The stacked layout's BEFORE / AFTER label. BEFORE measures about 46pt in
    /// the header font (SF Mono 10pt medium, 1.4pt tracking).
    public static let phaseLabelWidth: Double = 52

    /// Five cells and the four gaps between them: 152pt. The column headers and
    /// the low/high hints take this width too, so they line up with the cells.
    public static let scaleWidth = 5 * cellSize + 4 * cellSpacing
    /// A wide row, the label and both scales: 388pt.
    public static let wideWidth = labelWidth + 2 * columnSpacing + 2 * scaleWidth
    /// A stacked row, a phase label and one scale: 212pt.
    public static let stackedWidth = phaseLabelWidth + columnSpacing + scaleWidth
}
