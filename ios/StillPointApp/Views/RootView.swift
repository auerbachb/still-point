import SwiftUI
import GoogleSignIn
import StillPointShared
import UIKit

struct RootView: View {
    @State private var appVM = AppViewModel()
    @State private var reachability = NetworkReachabilityMonitor()
    @Environment(\.scenePhase) private var scenePhase
    /// #887: UI-test mode only. Settings requests `UITestAPIStore` has received.
    @State private var uiTestSettingsRequestCount = 0

    private enum Constants {
        static let routeAnimationDuration: Double = 0.3
        static let loadingAnimationDuration: Double = 0.2
        static let uiTestModeEnvironmentKey = "SP_UI_TEST_MODE"
        static let truthyEnvironmentValues: Set<String> = ["1", "true", "yes", "on"]
        static let currentViewIdentifierPrefix = "root.currentView."
        static let settingsRequestCountIdentifier = "uiTest.settingsRequestCount"
    }

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()
                .allowsHitTesting(false)

            // Always render the current-view branch so the accessibility
            // tree (and the `root.currentView.*` identifier on the ZStack
            // below) is consistent from t=0. Issue #276.
            currentRouteView

            // Brand-lockup overlay during cold-start auth check. Sits on top
            // of the current-view branch and dismisses when checkAuth flips
            // isLoading to false.
            if appVM.isLoading {
                ColdStartBrandOverlay(authStatusMessage: appVM.authStatusMessage)
                    .transition(.opacity)
            }
        }
        // Explicit accessibility marker for UI tests. Putting the identifier
        // on the ZStack itself proved unreliable on iOS 26, while a full-screen
        // SwiftUI accessibility overlay could still confuse XCUITest hit-point
        // resolution. This tiny UIKit marker is queryable but never interactive.
        .overlay(alignment: .topLeading) {
            if isUITestMode {
                uiTestMarkers
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UITestSettingsRequests.didRecord)) { note in
            guard let count = note.userInfo?[UITestSettingsRequests.countKey] as? Int else { return }
            // Each post carries the running total, so the largest one seen is the count.
            uiTestSettingsRequestCount = max(uiTestSettingsRequestCount, count)
        }
        .animation(.easeInOut(duration: Constants.routeAnimationDuration), value: appVM.currentView)
        .animation(.easeInOut(duration: Constants.loadingAnimationDuration), value: appVM.isLoading)
        .onAppear {
            syncIdleTimerForeground(scenePhase)
        }
        .task {
            reachability.ownerUserIdProvider = { appVM.currentUser?.id }
            reachability.onSynced = { appVM.refreshUserAfterSync() }
            await checkAuthAndFlushOfflineQueue()
        }
        // #665: connectivity returning is the read/identity half of the reconnect.
        // The monitor already flushes the queued sits itself (#557); this refreshes
        // who we are and today's state, in place, with no user-visible reset.
        // The view model owns the task so signing out can cancel it, rather than the
        // view spawning an unstructured one that outlives the session it started in.
        .onChange(of: reachability.isConnected) { wasConnected, isConnected in
            guard !wasConnected, isConnected else { return }
            appVM.refreshAfterReconnectInBackground()
        }
        .onChange(of: scenePhase) { _, phase in
            handleScenePhaseChange(phase)
        }
        .onOpenURL { url in
            // Let Google Sign-In claim its OAuth callback (reversed client-ID scheme)
            // before falling through to app deep-link routing.
            if GIDSignIn.sharedInstance.handle(url) { return }
            appVM.handleIncomingURL(url)
        }
        // Single authoritative wiring point for push-notification deep links
        // (issue #363). Do not assign `deepLinkHandler` anywhere else: the
        // coordinator is a shared singleton, so a second assignment is
        // last-writer-wins and fragile under multiple WindowGroup scenes.
        //
        // - Warm routing: a tapped push reaches the coordinator's
        //   `userNotificationCenter(_:didReceive:)`, which invokes this
        //   handler directly.
        // - Cold-start routing: a launch push arrives in
        //   `didFinishLaunchingWithOptions` before this `.task` runs; the
        //   coordinator queues it and its `deepLinkHandler.didSet` delivers
        //   the pending URL as soon as the handler is assigned here.
        //
        // `handlePushDeepLink` currently forwards to `handleIncomingURL`
        // (the same path `onOpenURL` uses) but stays a distinct entry point
        // for future push-specific logic (analytics, badge clearing).
        .task {
            PushNotificationCoordinator.shared.deepLinkHandler = { url in
                appVM.handlePushDeepLink(url)
            }
        }
    }

    // MARK: - Routing

    /// The screen for `appVM.currentView`. `Group` applies the shared
    /// `.transition(.opacity)` to whichever branch is active.
    private var currentRouteView: some View {
        Group {
            switch appVM.currentView {
            case .auth:
                AuthView(appVM: appVM, launchAuthStatusMessage: appVM.authStatusMessage)

            case .session(let sessionType, let track, let combined):
                SessionView(appVM: appVM, sessionType: sessionType, track: track, combined: combined)

            case .buddyHub:
                BuddySessionHubView(appVM: appVM)

            case .buddyCalendar:
                BuddyCalendarView(appVM: appVM, mode: .unified)

            case .buddyCalendarWithBuddy(let buddyId, let buddyUsername):
                BuddyCalendarView(
                    appVM: appVM,
                    mode: .perBuddy(buddyId: buddyId, buddyUsername: buddyUsername)
                )

            case .buddySession(let sessionId):
                BuddySessionContainerView(appVM: appVM, sessionId: sessionId)
                    .id(sessionId)

            case .completion(let sessionId, let clientSessionId, let clearPercent, let thoughtCount, let thoughts, let dayNumber, let sessionType, let track, let sessionCompleted, let duration, let bonusSeconds, let attentionLog, let attentionElapsed, let ambientSoundSummary, let combined):
                CompletionView(
                    appVM: appVM,
                    sessionId: sessionId,
                    clientSessionId: clientSessionId,
                    clearPercent: clearPercent,
                    thoughtCount: thoughtCount,
                    thoughts: thoughts,
                    dayNumber: dayNumber,
                    sessionType: sessionType,
                    track: track,
                    sessionCompleted: sessionCompleted,
                    duration: duration,
                    bonusSeconds: bonusSeconds,
                    attentionLog: attentionLog,
                    attentionElapsed: attentionElapsed,
                    ambientSoundSummary: ambientSoundSummary,
                    combined: combined
                )

            case .breathCounting:
                BreathCountingView(appVM: appVM)

            case .focusPicker:
                FocusCategoryPickerView(appVM: appVM)

            case .focusActivity(let category, let focusActivityDay):
                FocusActivityView(appVM: appVM, category: category, focusActivityDay: focusActivityDay)

            case .logReason(let date):
                LogReasonView(appVM: appVM, targetDate: date)

            default:
                MainTabView(appVM: appVM)
                    // #916: keyed by the account, so a different account adopted while
                    // the route stays on the tabs rebuilds History, Journal, Board,
                    // Settings and Home with fresh state and loads. Re-confirming the
                    // same account keeps the key and the tabs as they are.
                    .id(appVM.currentUser?.id)
            }
        }
        .transition(.opacity)
    }

    // MARK: - Lifecycle

    private func checkAuthAndFlushOfflineQueue() async {
        await appVM.checkAuth()
        await reachability.flushOfflineQueue(ownerUserId: appVM.currentUser?.id)
    }

    private func syncIdleTimerForeground(_ phase: ScenePhase) {
        SessionIdleTimerController.syncSceneForegroundActive(
            appVM: appVM,
            isForegroundActive: phase == .active
        )
    }

    private func handleScenePhaseChange(_ phase: ScenePhase) {
        syncIdleTimerForeground(phase)
        switch phase {
        case .active, .inactive, .background:
            // Reconcile shields on every lifecycle transition so a stale
            // unlock cannot survive when the app is backgrounded (#549).
            appVM.appBlockingManager.refreshShielding()
        @unknown default:
            break
        }
        if phase == .active {
            SessionIdleTimerController.applyDesiredIdleTimerState()
            Task {
                await checkAuthAndFlushOfflineQueue()
            }
        } else if phase == .inactive || phase == .background {
            // Multi-window: only clear when no scene is foreground-active (issue #87).
            SessionIdleTimerController.applyBackgroundIdleTimerPolicyIfNoForegroundScene()
        }
        if phase == .background {
            // #663: while the app stays closed, a background refresh is the only
            // way a sit saved on the web reaches the widget.
            BackgroundRefreshScheduler.reschedule()
            // #887: arms the held `me()` read for the scene-activation check when
            // the app comes back. No-op unless a UI test configured a hold.
            if isUITestMode {
                Task { await APIClient.shared.uiTestSceneDidEnterBackground() }
            }
        }
    }

    // MARK: - UI-test accessibility markers

    @ViewBuilder
    private var uiTestMarkers: some View {
        AccessibilityMarkerView(
            identifier: Constants.currentViewIdentifierPrefix + viewAccessibilitySlug,
            value: coldStartMetricAccessibilityValue
        )
        .uiTestMarkerFrame()

        // #887: how many Settings requests reached `UITestAPIStore` since
        // launch, so a UI test can check that a dropped save sent nothing.
        AccessibilityMarkerView(
            identifier: Constants.settingsRequestCountIdentifier,
            value: String(uiTestSettingsRequestCount)
        )
        .uiTestMarkerFrame()
    }

    private var viewAccessibilitySlug: String {
        switch appVM.currentView {
        case .auth:
            return "auth"
        case .home:
            return "home"
        case .session:
            return "session"
        case .buddyHub:
            return "buddyHub"
        case .buddyCalendar:
            return "buddyCalendar"
        case .buddyCalendarWithBuddy:
            return "buddyCalendarWithBuddy"
        case .buddySession:
            return "buddySession"
        case .completion:
            return "completion"
        case .breathCounting:
            return "breathCounting"
        case .focusPicker:
            return "focusPicker"
        case .focusActivity:
            return "focusActivity"
        case .logReason:
            return "logReason"
        case .history:
            return "history"
        case .journal:
            return "journal"
        case .board:
            return "board"
        case .settings:
            return "settings"
        }
    }

    private var coldStartMetricAccessibilityValue: String {
        guard let ms = appVM.lastColdStartAuthCheckMs else { return "coldStartAuthCheckMs=unknown" }
        return "coldStartAuthCheckMs=\(ms)"
    }

    private var isUITestMode: Bool {
        truthy(ProcessInfo.processInfo.environment[Constants.uiTestModeEnvironmentKey])
    }

    private func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return Constants.truthyEnvironmentValues.contains(value.lowercased())
    }
}

/// Brand lockup shown over the current route while the cold-start auth check
/// runs, plus any auth status message. Decorative only: not hit-testable and
/// hidden from accessibility.
private struct ColdStartBrandOverlay: View {
    let authStatusMessage: String?

    private enum Constants {
        static let subtitleTracking: CGFloat = 4
        static let statusMessageFontSize: CGFloat = 12
    }

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()
            VStack(spacing: SPSpacing.s2) {
                Text("Still Point")
                    .font(SPFont.brandTitle)
                    .foregroundStyle(Color(SPColor.fg))
                Text("ATTENTION TRAINING")
                    .font(SPFont.brandSubtitle)
                    .foregroundStyle(Color(SPColor.fg3))
                    .tracking(Constants.subtitleTracking)
                if let authStatusMessage {
                    Text(authStatusMessage)
                        .font(SPFont.mono(Constants.statusMessageFontSize))
                        .foregroundStyle(SPColor.dangerMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SPSpacing.s4)
                        .padding(.top, SPSpacing.s3)
                        .accessibilityIdentifier("root.authStatusMessage")
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private extension View {
    /// Shrinks a UI-test accessibility marker to a 1x1, non-interactive point.
    func uiTestMarkerFrame() -> some View {
        frame(width: 1, height: 1)
            .allowsHitTesting(false)
    }
}

private struct AccessibilityMarkerView: UIViewRepresentable {
    let identifier: String
    let value: String

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = true
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        view.accessibilityIdentifier = identifier
        view.accessibilityValue = value
        view.accessibilityLabel = identifier
    }
}
