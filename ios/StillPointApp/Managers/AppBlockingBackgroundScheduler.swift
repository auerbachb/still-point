import BackgroundTasks
import Foundation

/// Schedules opportunistic background refresh so app-block shields are
/// reconciled even when DeviceActivity callbacks are delayed (#549).
enum AppBlockingBackgroundScheduler {
    static let taskIdentifier = "com.brettonauerbach.stillpoint.app-block-refresh"

    /// Earliest time before the system may run the next refresh.
    private static let minimumLeadTime: TimeInterval = 15 * 60

    static func registerIfNeeded() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        #if targetEnvironment(simulator)
        return
        #else
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            handleRefresh(task)
        }
        #endif
    }

    static func scheduleRefresh(preferring earliestBeginDate: Date? = nil) {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        #if targetEnvironment(simulator)
        return
        #else
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = earliestBeginDate ?? Date(timeIntervalSinceNow: minimumLeadTime)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // The system coalesces duplicate submissions; a failure here just
            // means this particular request was not queued.
        }
        #endif
    }

    static func cancelRefresh() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        #if targetEnvironment(simulator)
        return
        #else
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
        #endif
    }

    #if !targetEnvironment(simulator)
    private static func handleRefresh(_ task: BGTask) {
        guard let refreshTask = task as? BGAppRefreshTask else {
            task.setTaskCompleted(success: false)
            return
        }
        var didComplete = false
        refreshTask.expirationHandler = {
            guard !didComplete else { return }
            didComplete = true
            refreshTask.setTaskCompleted(success: false)
        }

        AppBlockingShared.syncShieldStateFromSharedDefaults()

        if AppBlockingShared.shouldScheduleBackgroundShieldRefresh() {
            scheduleRefresh(preferring: AppBlockingShared.preferredBackgroundRefreshDate())
        }
        guard !didComplete else { return }
        didComplete = true
        refreshTask.setTaskCompleted(success: true)
    }
    #endif
}
