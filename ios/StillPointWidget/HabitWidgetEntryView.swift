import SwiftUI
import WidgetKit
import StillPointShared

struct HabitWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: HabitEntry

    /// #684: on a two-a-day schedule each session gets its own weekday row, so
    /// finishing either sit is visible immediately and it stays obvious which
    /// one is still owed.
    private var isDualTrack: Bool { entry.data.dualTrackEnabled }

    var body: some View {
        switch family {
        case .systemMedium:
            mediumLayout
        default:
            smallLayout
        }
    }

    private var smallLayout: some View {
        VStack(alignment: .leading, spacing: 6) {
            if entry.data.isLoggedIn {
                Label {
                    Text("\(entry.data.streak)")
                        .font(.system(size: 30, weight: .light, design: .serif))
                        .foregroundStyle(WidgetPalette.foreground)
                } icon: {
                    Image(systemName: "flame.fill")
                        .foregroundStyle(WidgetPalette.accent)
                }
                .labelStyle(.titleAndIcon)

                Text("day \(entry.data.currentDay)")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(WidgetPalette.foregroundMuted)
                    .tracking(1)

                Spacer(minLength: 0)

                weekSection(metrics: .small)
            } else {
                Text("Still Point")
                    .font(.system(size: 16, weight: .medium, design: .serif))
                    .foregroundStyle(WidgetPalette.foreground)
                Text("Sign in to track your streak")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(WidgetPalette.foregroundMuted)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
    }

    private var mediumLayout: some View {
        // Two rows need vertical room the medium family barely has, so the
        // dual-track case trims the headline numerals and the stack spacing.
        let numeralSize: CGFloat = isDualTrack ? 34 : 40
        let stackSpacing: CGFloat = isDualTrack ? 8 : 12
        return VStack(alignment: .leading, spacing: stackSpacing) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("STREAK")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(WidgetPalette.foregroundFaint)
                        .tracking(2)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: "flame.fill")
                            .foregroundStyle(WidgetPalette.accent)
                        Text(entry.data.isLoggedIn ? "\(entry.data.streak)" : "—")
                            .font(.system(size: numeralSize, weight: .light, design: .serif))
                            .foregroundStyle(WidgetPalette.foreground)
                    }
                }

                Spacer(minLength: 0)

                if entry.data.isLoggedIn {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("DAY")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(WidgetPalette.foregroundFaint)
                            .tracking(2)
                        Text("\(entry.data.currentDay)")
                            .font(.system(size: numeralSize, weight: .light, design: .serif))
                            .foregroundStyle(WidgetPalette.foreground)
                        if isDualTrack {
                            Text("track 2 · day \(entry.data.secondTrackDay)")
                                .font(.system(size: 11, weight: .regular, design: .monospaced))
                                .foregroundStyle(WidgetPalette.foregroundMuted)
                        } else {
                            Text("\(entry.data.primaryDurationSeconds)s · \(StillPoint.blockCount(forDuration: entry.data.primaryDurationSeconds)) blocks")
                                .font(.system(size: 11, weight: .regular, design: .monospaced))
                                .foregroundStyle(WidgetPalette.foregroundMuted)
                        }
                    }
                } else {
                    Text("Sign in")
                        .font(.system(size: 14, weight: .medium, design: .serif))
                        .foregroundStyle(WidgetPalette.foregroundMuted)
                }
            }

            if entry.data.isLoggedIn {
                if !isDualTrack {
                    Spacer(minLength: 0)
                }
                weekSection(metrics: .medium)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
    }

    /// One weekday row per configured session on a two-a-day schedule, or the
    /// single unlabeled row for a one-session setup (#684).
    @ViewBuilder
    private func weekSection(metrics: WeekMetrics) -> some View {
        if isDualTrack {
            // Morning row first. The designation is a label: completing the
            // evening track checks PM even when the sit happens in the morning.
            let tracks = SessionPeriod.orderedTracks(longSession: entry.data.longSessionPeriod)
            VStack(alignment: .leading, spacing: metrics.rowSpacing) {
                weekdayHeader(metrics: metrics)
                trackWeekRow(tracks[0], metrics: metrics)
                trackWeekRow(tracks[1], metrics: metrics)
            }
        } else {
            weekRow(
                entry.data.weekMarks(now: entry.date),
                dotSize: metrics.singleDotSize,
                spacing: metrics.singleSpacing
            )
        }
    }

    /// Duolingo-style weekday row: single-letter labels over per-day marks —
    /// a filled check for completed sits, a hollow ring for missed days, and a
    /// dotted ring for today when it's still pending.
    private func weekRow(_ marks: [WidgetDayMark], dotSize: CGFloat, spacing: CGFloat) -> some View {
        HStack(spacing: spacing) {
            ForEach(marks) { mark in
                VStack(spacing: 4) {
                    Text(mark.letter)
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(mark.isToday ? WidgetPalette.foreground : WidgetPalette.foregroundFaint)
                    dayMark(mark, size: dotSize)
                }
                .frame(maxWidth: .infinity)
                // Collapse the decorative letter + circle into one VoiceOver element.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(mark.weekdayName)
                .accessibilityValue(Self.accessibilityState(for: mark))
            }
        }
    }

    /// Shared weekday-letter header for the two-row layout: both tracks cover the
    /// same seven days, so the letters are drawn once and the rows align under
    /// them. Decorative — each track's marks carry the weekday in VoiceOver.
    private func weekdayHeader(metrics: WeekMetrics) -> some View {
        HStack(spacing: metrics.spacing) {
            Color.clear
                .frame(width: metrics.labelWidth, height: 1)
            ForEach(entry.data.weekMarks(for: .primary, now: entry.date)) { mark in
                Text(mark.letter)
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(mark.isToday ? WidgetPalette.foreground : WidgetPalette.foregroundFaint)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    /// One track's own row of per-day marks. The gutter holds "AM" or "PM"
    /// (#708) instead of the track name, sized so the label is not truncated.
    private func trackWeekRow(_ track: Track, metrics: WeekMetrics) -> some View {
        let period = SessionPeriod.period(for: track, longSession: entry.data.longSessionPeriod)
        let label = period.widgetLabel
        return HStack(spacing: metrics.spacing) {
            Text(label)
                .font(.system(size: metrics.labelSize, weight: .semibold, design: .monospaced))
                .foregroundStyle(WidgetPalette.foregroundFaint)
                .lineLimit(1)
                .frame(width: metrics.labelWidth, alignment: .leading)
                .accessibilityHidden(true)
            ForEach(entry.data.weekMarks(for: track, now: entry.date)) { mark in
                dayMark(mark, size: metrics.dotSize)
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(label), \(mark.weekdayName)")
                    .accessibilityValue(Self.accessibilityState(for: mark))
            }
        }
    }

    private static func accessibilityState(for mark: WidgetDayMark) -> String {
        if mark.done { return "Completed" }
        return mark.isToday ? "Not done yet" : "Missed"
    }

    @ViewBuilder
    private func dayMark(_ mark: WidgetDayMark, size: CGFloat) -> some View {
        ZStack {
            if mark.done {
                Circle().fill(WidgetPalette.accent)
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(WidgetPalette.onAccent)
            } else if mark.isToday {
                Circle()
                    .strokeBorder(
                        WidgetPalette.foregroundMuted,
                        style: StrokeStyle(lineWidth: 1.4, dash: [2, 2])
                    )
            } else {
                Circle().strokeBorder(WidgetPalette.foregroundFaint.opacity(0.5), lineWidth: 1.2)
            }
        }
        .frame(width: size, height: size)
    }
}

/// Per-family sizing for the weekday section. Dual-track rows are smaller and
/// tighter than the single row so both fit legibly in the same space (#684).
private struct WeekMetrics {
    /// Dot diameter for the single-row (single-track) layout.
    let singleDotSize: CGFloat
    /// Column spacing for the single-row layout.
    let singleSpacing: CGFloat
    /// Dot diameter for each dual-track row.
    let dotSize: CGFloat
    /// Column spacing for the dual-track rows and their shared header.
    let spacing: CGFloat
    /// Vertical gap between the header and each dual-track row.
    let rowSpacing: CGFloat
    /// Fixed-width gutter holding each row's "AM" / "PM" label.
    let labelWidth: CGFloat
    let labelSize: CGFloat

    static let small = WeekMetrics(
        singleDotSize: 13,
        singleSpacing: 3,
        dotSize: 11,
        spacing: 3,
        rowSpacing: 3,
        labelWidth: 20,
        labelSize: 9
    )

    static let medium = WeekMetrics(
        singleDotSize: 20,
        singleSpacing: 10,
        dotSize: 15,
        spacing: 8,
        rowSpacing: 3,
        labelWidth: 28,
        labelSize: 11
    )
}

enum WidgetPalette {
    static let background = Color(red: 26/255, green: 24/255, blue: 22/255)
    static let foreground = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.92)
    static let foregroundMuted = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.52)
    static let foregroundFaint = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.45)
    static let accent = Color(red: 251/255, green: 191/255, blue: 36/255)
    static let onAccent = Color(red: 26/255, green: 24/255, blue: 22/255)
    static let success = Color(red: 74/255, green: 222/255, blue: 128/255)
}

#if DEBUG
struct HabitWidget_Previews: PreviewProvider {
    private static let sample = WidgetData.preview
    private static let dualSample = WidgetData.previewDualTrack

    static var previews: some View {
        HabitWidgetEntryView(entry: HabitEntry(date: Date(), data: sample))
            .previewContext(WidgetPreviewContext(family: .systemSmall))
        HabitWidgetEntryView(entry: HabitEntry(date: Date(), data: sample))
            .previewContext(WidgetPreviewContext(family: .systemMedium))
        HabitWidgetEntryView(entry: HabitEntry(date: Date(), data: dualSample))
            .previewContext(WidgetPreviewContext(family: .systemSmall))
        HabitWidgetEntryView(entry: HabitEntry(date: Date(), data: dualSample))
            .previewContext(WidgetPreviewContext(family: .systemMedium))
    }
}
#endif
