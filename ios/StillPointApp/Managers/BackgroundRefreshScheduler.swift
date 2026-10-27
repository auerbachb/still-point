import BackgroundTasks
import Foundation
import StillPointShared

/// The app's one `BGAppRefreshTask`. Two jobs need a background wake, and they
/// share it:
/// - reconciling app-block shields when DeviceActivity callbacks are delayed (#549);
/// - refetching the widget's session history, so a sit saved on the web reaches
///   the home-screen widget while the app stays closed (#663).
///
/// They share one task because iOS keeps at most one pending app-refresh request
/// per app (see `BackgroundRefreshSchedule`). A second identifier would fail to
/// submit while this one was pending, or hold the slot and starve it. So every
/// submit carries the earliest time either job wants, and every run does both.
///
/// The identifier keeps its #549 name, so a request queued by an earlier build
/// still reaches a registered handler.
enum BackgroundRefreshScheduler {
    static let taskIdentifier = "com.brettonauerbach.stillpoint.app-block-refresh"

    static func registerIfNeeded() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        #if targetEnvironment(simulator)
        return
        #else
        // The main queue, so a run starts on the main actor. The widget refresh
        // it drives is main-actor state, shared with the foreground app.
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: .main
        ) { task in
            MainActor.assumeIsolated { handleRefresh(task) }
        }
        #endif
    }

    /// App blocking's half (#549). `date` is when the shields next want a
    /// reconcile, or `nil` once there is nothing left to guard.
    static func scheduleShieldRefresh(at date: Date?) {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        #if targetEnvironment(simulator)
        return
        #else
        submit(shieldRefresh: date, widgetRefresh: wantedWidgetRefresh())
        #endif
    }

    /// Re-plan the request from what each job wants right now. The widget side
    /// calls this when the app goes to the background, after each successful
    /// history refresh, and on sign-out. Each run calls it before its work.
    static func reschedule() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        #if targetEnvironment(simulator)
        return
        #else
        submit(shieldRefresh: wantedShieldRefresh(), widgetRefresh: wantedWidgetRefresh())
        #endif
    }

    #if !targetEnvironment(simulator)
    /// Submit one request for the earlier of the two times, or cancel the
    /// pending one when neither job wants a run.
    private static func submit(shieldRefresh: Date?, widgetRefresh: Date?) {
        guard let earliestBeginDate = BackgroundRefreshSchedule.earliestBeginDate(
            shieldRefresh: shieldRefresh,
            widgetRefresh: widgetRefresh
        ) else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = earliestBeginDate
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // A submit replaces the pending request rather than adding a second
            // one; a failure here just means this particular request was not
            // queued.
        }
    }

    /// When the shields next want a reconcile, read from the shared store the
    /// way a run always has (#549).
    private static func wantedShieldRefresh() -> Date? {
        AppBlockingShared.shouldScheduleBackgroundShieldRefresh()
            ? AppBlockingShared.preferredBackgroundRefreshDate()
            : nil
    }

    /// When the widget next wants a refresh: soon, while an account is signed
    /// in on this device. A run refreshes as the cached identity, so that is
    /// also what decides whether a run is wanted.
    private static func wantedWidgetRefresh() -> Date? {
        BackgroundRefreshSchedule.widgetRefreshDate(
            signedIn: CachedIdentityStore.load() != nil,
            now: Date()
        )
    }

    /// The background refresh's own backfill, with its own marker and in-flight
    /// fetch, separate from every scene's.
    @MainActor private static let widgetRefresher = WidgetHistoryRefresher()

    @MainActor
    private static func handleRefresh(_ task: BGTask) {
        guard let refreshTask = task as? BGAppRefreshTask else {
            task.setTaskCompleted(success: false)
            return
        }
        let run = Run(task: refreshTask)
        // `@Sendable`, so the handler is not tied to the main actor: the system
        // may call it on any queue, and it hops to the run from there.
        refreshTask.expirationHandler = { @Sendable in
            Task { @MainActor in run.expire() }
        }
        // App blocking (#549), as before: reconcile shields from the shared store.
        AppBlockingShared.syncShieldStateFromSharedDefaults()
        run.start()
    }

    /// The widget's half of a run (#663): the same backfill a scene runs, as the
    /// account signed in on this device.
    ///
    /// It never calls `/api/auth/me`. That request writes missed-day recovery
    /// state keyed on the client's practice day, and only the foreground auth
    /// flow computes that day. So the snapshot's day number and track settings
    /// come from the identity the app last confirmed (`CachedIdentityStore`,
    /// #665). The rows and the streak come from the fresh history.
    ///
    /// It passes no `didFetch`. The tracking-controls unlock backfill (#526)
    /// belongs to a scene, and the next foreground refresh runs it.
    @MainActor
    private static func refreshWidget() async -> Bool {
        guard let attempt = widgetRefresher.refresh(
            currentUser: { CachedIdentityStore.load() },
            primaryDoneToday: { sessions, now in
                WidgetDataStore.primaryStandardSitCompleted(
                    on: WidgetDataStore.localDayString(now),
                    in: sessions
                )
            }
        ) else {
            // Nobody is signed in, or this refresher's last fetch is still
            // fresh. Either way there is nothing to fetch.
            return true
        }
        return await attempt.value
    }

    /// One launch of the task. It re-arms the next launch, refreshes the widget,
    /// and completes exactly once, whether its work finishes first or the system
    /// expires it.
    @MainActor
    private final class Run {
        private let task: BGAppRefreshTask
        private var completion = BackgroundTaskCompletion()

        init(task: BGAppRefreshTask) {
            self.task = task
        }

        func start() {
            // Re-arm before the work, as Apple's sample does, so the chain
            // survives a run the system cuts short.
            BackgroundRefreshScheduler.reschedule()
            Task {
                let reachedWidget = await BackgroundRefreshScheduler.refreshWidget()
                complete(success: reachedWidget)
            }
        }

        func expire() {
            // The expiration handler hops here, so the work can finish first. A
            // run that already completed did its work, and its report stands.
            guard completion.reported == nil else { return }
            // Cancelling clears the refresher's marker too, so the next run
            // fetches instead of trusting an attempt that never landed.
            BackgroundRefreshScheduler.widgetRefresher.cancel()
            complete(success: false)
        }

        private func complete(success: Bool) {
            guard completion.report(success: success) else { return }
            task.setTaskCompleted(success: success)
        }
    }
    #endif
}
