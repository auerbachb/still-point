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
                        .font(.system(size: 34, weight: .light, design: .serif))
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

                if entry.data.isPrimaryCompleteForToday(at: entry.date) {
                    doneBadge
                } else {
                    Text("\(entry.data.primaryDurationSeconds)s sit")
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundStyle(WidgetPalette.foregroundFaint)
                }
            } else {
                Text("Still Point")
                    .font(.system(size: 16, weight: .medium, design: .serif))
                    .foregroundStyle(WidgetPalette.foreground)
                Text("Sign in to track your streak")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(WidgetPalette.foregroundMuted)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
    }

    private var mediumLayout: some View {
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
                    if entry.data.isPrimaryCompleteForToday(at: entry.date) {
                        doneBadge
                    }
                }
            } else {
                Text("Sign in")
                    .font(.system(size: 14, weight: .medium, design: .serif))
                    .foregroundStyle(WidgetPalette.foregroundMuted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(16)
    }

    private var doneBadge: some View {
        Label("Done today", systemImage: "checkmark.circle.fill")
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(WidgetPalette.success)
    }
}

enum WidgetPalette {
    static let background = Color(red: 26/255, green: 24/255, blue: 22/255)
    static let foreground = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.92)
    static let foregroundMuted = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.52)
    static let foregroundFaint = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.45)
    static let accent = Color(red: 251/255, green: 191/255, blue: 36/255)
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
