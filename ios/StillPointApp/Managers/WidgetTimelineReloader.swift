import WidgetKit

enum WidgetTimelineReloader {
    static let habitWidgetKind = "HabitWidget"

    static func reloadHabitWidget() {
        // WidgetCenter reload can stall cold-start auth in the UI-test simulator
        // lane when the widget extension is embedded; the suite never exercises
        // widgets, so skip entirely under SP_UI_TEST_MODE.
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        DispatchQueue.main.async {
            WidgetCenter.shared.reloadTimelines(ofKind: habitWidgetKind)
        }
    }
}
