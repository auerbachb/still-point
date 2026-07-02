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
        let data: WidgetData
        if context.isPreview {
            data = .preview
        } else if let loaded = WidgetDataStore.load() {
            data = WidgetDataStore.normalizedForDisplay(loaded)
        } else {
            data = .loggedOut
        }
        completion(HabitEntry(date: Date(), data: data))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitEntry>) -> Void) {
        let now = Date()
        let raw = WidgetDataStore.load() ?? .loggedOut
        let data = WidgetDataStore.normalizedForDisplay(raw, now: now)
        let entry = HabitEntry(date: now, data: data)
        let nextRefresh = Calendar.current.startOfDay(for: now.addingTimeInterval(86400))
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}
