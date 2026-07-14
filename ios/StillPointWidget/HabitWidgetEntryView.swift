import SwiftUI
import WidgetKit
import StillPointShared

struct HabitWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: HabitEntry

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

                weekRow(entry.data.weekMarks(now: entry.date), dotSize: 13, spacing: 3)
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
        VStack(alignment: .leading, spacing: 12) {
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
                            .font(.system(size: 40, weight: .light, design: .serif))
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
                            .font(.system(size: 40, weight: .light, design: .serif))
                            .foregroundStyle(WidgetPalette.foreground)
                        if entry.data.dualTrackEnabled {
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
                Spacer(minLength: 0)
                weekRow(entry.data.weekMarks(now: entry.date), dotSize: 20, spacing: 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
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
    private static let sample = WidgetData(
        isLoggedIn: true,
        userId: "preview",
        currentDay: 24,
        secondTrackDay: 8,
        dualTrackEnabled: false,
        primaryDoneToday: false,
        secondDoneToday: false,
        streak: 12,
        completedDates: WidgetDataStore.previewCompletedDates(),
        lastUpdated: Date()
    )

    static var previews: some View {
        HabitWidgetEntryView(entry: HabitEntry(date: Date(), data: sample))
            .previewContext(WidgetPreviewContext(family: .systemSmall))
        HabitWidgetEntryView(entry: HabitEntry(date: Date(), data: sample))
            .previewContext(WidgetPreviewContext(family: .systemMedium))
    }
}
#endif
