import Foundation

/// #898: the label a History row shows for one sit, in the column beside its
/// bar. Mirrors web `historySessionLabel` (`src/lib/historySessionLabel.ts`),
/// except that iOS's Quick and Breath rows keep their per-day ordinals
/// ("Quick 1", "Breath 2") and a breath row with a count reads "Breath 12b".
public enum HistorySessionLabel {
    /// - Parameter indexInDay: this sit's 1-based place among the day's sits, as
    ///   History counts them.
    ///
    /// A combined sit (#769) reads "Combined" with no ordinal, as on web. Only a
    /// standard row can be combined (`POST /api/sessions` refuses any other), so
    /// a quick, breath or focus row keeps its own label whatever `combined` says.
    public static func label(
        sessionType: SessionType,
        combined: Bool?,
        breathCount: Int?,
        focusCategory: FocusCategory?,
        indexInDay: Int
    ) -> String {
        switch sessionType {
        case .quick:
            return "Quick \(indexInDay)"
        case .breath:
            if let breathCount, breathCount > 0 {
                return "Breath \(breathCount)b"
            }
            return "Breath \(indexInDay)"
        case .standard:
            if combined == true { return "Combined" }
            return "Session \(indexInDay)"
        case .focus:
            // #839: "Focus · Reading", or "Focus" with no category, as on web. No
            // per-day number.
            return FocusCategory.sessionLabel(for: focusCategory)
        }
    }

    /// `label` for a fetched session row.
    public static func label(for session: SessionDTO, indexInDay: Int) -> String {
        label(
            sessionType: session.sessionType,
            combined: session.combined,
            breathCount: session.breathCount,
            focusCategory: session.focusCategory,
            indexInDay: indexInDay
        )
    }
}
