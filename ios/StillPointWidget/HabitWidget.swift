import WidgetKit
import SwiftUI
import StillPointShared

struct HabitWidget: Widget {
    static let kind = "HabitWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: HabitTimelineProvider()) { entry in
            HabitWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    WidgetPalette.background
                }
        }
        .configurationDisplayName("Still Point")
        .description("Your streak and daily sit progress.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct HabitEntry: TimelineEntry {
    let date: Date
    let data: WidgetData
}

struct HabitTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> HabitEntry {
        HabitEntry(date: Date(), data: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (HabitEntry) -> Void) {
        completion(HabitEntry(date: Date(), data: WidgetDataStore.load() ?? .preview))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitEntry>) -> Void) {
        let data = WidgetDataStore.load() ?? .loggedOut
        let entry = HabitEntry(date: Date(), data: data)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

private extension WidgetData {
    static let preview = WidgetData(
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
}
