import WidgetKit

enum WidgetTimelineReloader {
    static let habitWidgetKind = "HabitWidget"

    static func reloadHabitWidget() {
        WidgetCenter.shared.reloadTimelines(ofKind: habitWidgetKind)
    }
}
