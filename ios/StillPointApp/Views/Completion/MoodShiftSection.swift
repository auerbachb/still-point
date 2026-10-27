import SwiftUI
import StillPointShared

/// Which half of a mood's before/after pair a cell belongs to.
enum MoodMatrixColumn {
    case before
    case after
}

/// The recap's MOOD SHIFT card (#472 / #635): the before/after grid plus its
/// saved and error lines. Display only — the parent owns the matrix, the
/// autosave and the #792 sync rules, and hears about every tap through
/// `onToggle`.
struct MoodShiftSection: View {
    let moodMatrix: [MoodKey: MoodMatrixEntry]
    /// True while a save is in flight, the screen is returning home, or the
    /// stored matrix has not loaded yet (#792).
    let cellsDisabled: Bool
    let saved: Bool
    let saveError: String?
    let onToggle: (MoodKey, MoodMatrixColumn, Int) -> Void

    /// #885: the column-header, scale-hint and mood rows share one label width
    /// and one spacing so their columns line up. #911: the headers, hints and
    /// cell groups also share one scale width, so they line up in the stacked
    /// layout too. The widths come from `MoodMatrixGeometry`, whose tests pin
    /// which iPhones get which layout.
    private enum Layout {
        static let labelWidth = CGFloat(MoodMatrixGeometry.labelWidth)
        static let rowSpacing = CGFloat(MoodMatrixGeometry.columnSpacing)
        static let boxSpacing = CGFloat(MoodMatrixGeometry.cellSpacing)
        static let cellSize = CGFloat(MoodMatrixGeometry.cellSize)
        static let scaleWidth = CGFloat(MoodMatrixGeometry.scaleWidth)
        static let phaseLabelWidth = CGFloat(MoodMatrixGeometry.phaseLabelWidth)
        /// Between a stacked mood's label, its BEFORE row and its AFTER row.
        static let stackedRowSpacing: CGFloat = 4
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("MOOD SHIFT")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            // #911: a wide row needs 388pt, more than the 327pt column of a
            // 375pt iPhone. Where it does not fit, each mood stacks BEFORE above
            // AFTER instead. Only one layout is shown, so the cell identifiers
            // stay unique.
            ViewThatFits(in: .horizontal) {
                wideGrid
                stackedGrid
            }

            if saved {
                Text("mood saved")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(SPColor.green)
                    .accessibilityIdentifier("completion.moodMatrixSavedIndicator")
            }

            if let saveError {
                Text(saveError)
                    .font(SPFont.mono(11))
                    .foregroundStyle(SPColor.dangerMuted)
            }
        }
    }

    /// BEFORE and AFTER side by side, each mood on one row.
    private var wideGrid: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            columnHeaders
            scaleHints

            VStack(spacing: SPSpacing.s2) {
                ForEach(MoodKey.allCases, id: \.self) { key in
                    wideRow(for: key)
                }
            }
        }
    }

    /// #911: one low/high hint row, then each mood's label on a line of its
    /// own, followed by a BEFORE row and an AFTER row. Centered in the
    /// section, as on web.
    private var stackedGrid: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            HStack(spacing: Layout.rowSpacing) {
                Text("")
                    .frame(width: Layout.phaseLabelWidth)
                scaleHint
            }

            ForEach(MoodKey.allCases, id: \.self) { key in
                stackedBlock(for: key)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var columnHeaders: some View {
        HStack(spacing: Layout.rowSpacing) {
            Text("")
                .frame(width: Layout.labelWidth, alignment: .trailing)
            sideLabel(.before)
                .frame(width: Layout.scaleWidth)
                .frame(maxWidth: .infinity)
            sideLabel(.after)
                .frame(width: Layout.scaleWidth)
                .frame(maxWidth: .infinity)
        }
    }

    private var scaleHints: some View {
        HStack(spacing: Layout.rowSpacing) {
            Text("")
                .frame(width: Layout.labelWidth)
            ForEach(0..<2, id: \.self) { _ in
                scaleHint
                    .frame(maxWidth: .infinity)
            }
        }
    }

    /// Low/high ends of the scale, one scale wide so each end sits over the
    /// first or the fifth cell.
    private var scaleHint: some View {
        HStack {
            Text("low")
            Spacer()
            Text("high")
        }
        .font(SPFont.mono(9))
        .foregroundStyle(Color(SPColor.fg4))
        .frame(width: Layout.scaleWidth)
    }

    /// The BEFORE / AFTER column headers, and the stacked layout's row labels.
    private func sideLabel(_ column: MoodMatrixColumn) -> some View {
        Text(column == .before ? "BEFORE" : "AFTER")
            .font(SPFont.mono(10, weight: .medium))
            .foregroundStyle(Color(SPColor.fg4))
            .tracking(1.4)
            .lineLimit(1)
    }

    private func moodLabel(_ key: MoodKey) -> some View {
        Text(key.label.uppercased())
            .font(SPFont.mono(10, weight: .medium))
            .foregroundStyle(Color(SPColor.fg3))
            .tracking(1)
            .lineLimit(1)
    }

    private func wideRow(for key: MoodKey) -> some View {
        let entry = moodMatrix[key] ?? MoodMatrixEntry()
        return HStack(spacing: Layout.rowSpacing) {
            moodLabel(key)
                .frame(width: Layout.labelWidth, alignment: .trailing)

            tapRow(moodKey: key, column: .before, selected: entry.before)
                .frame(maxWidth: .infinity)

            tapRow(moodKey: key, column: .after, selected: entry.after)
                .frame(maxWidth: .infinity)
        }
    }

    private func stackedBlock(for key: MoodKey) -> some View {
        let entry = moodMatrix[key] ?? MoodMatrixEntry()
        return VStack(alignment: .leading, spacing: Layout.stackedRowSpacing) {
            moodLabel(key)

            ForEach([MoodMatrixColumn.before, .after], id: \.self) { column in
                HStack(spacing: Layout.rowSpacing) {
                    sideLabel(column)
                        .frame(width: Layout.phaseLabelWidth, alignment: .trailing)

                    tapRow(
                        moodKey: key,
                        column: column,
                        selected: column == .before ? entry.before : entry.after
                    )
                }
            }
        }
    }

    private func tapRow(moodKey: MoodKey, column: MoodMatrixColumn, selected: Int?) -> some View {
        HStack(spacing: Layout.boxSpacing) {
            ForEach(1...5, id: \.self) { level in
                Button {
                    onToggle(moodKey, column, level)
                } label: {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(boxFill(selected: selected == level, level: level))
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .stroke(
                                    selected == level ? SPColor.greenBorderSubtle : SPColor.border2,
                                    lineWidth: 1
                                )
                        )
                        .overlay {
                            if selected == level {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(SPColor.green.opacity(0.35 + Double(level) * 0.12))
                                    .frame(width: 10, height: 10)
                            }
                        }
                        .frame(width: Layout.cellSize, height: Layout.cellSize)
                }
                .disabled(cellsDisabled)
                .accessibilityIdentifier(accessibilityId(moodKey: moodKey, column: column, level: level))
            }
        }
    }

    private func boxFill(selected: Bool, level: Int) -> Color {
        if selected {
            return SPColor.green.opacity(0.08 + Double(level) * 0.07)
        }
        return Color(SPColor.surface1)
    }

    private func accessibilityId(moodKey: MoodKey, column: MoodMatrixColumn, level: Int) -> String {
        let side = column == .before ? "before" : "after"
        return "completion.moodMatrix.\(moodKey.rawValue).\(side).\(level)"
    }
}
