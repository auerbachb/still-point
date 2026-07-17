import SwiftUI
import GoogleSignIn
import StillPointShared
import UIKit

struct RootView: View {
    @State private var appVM = AppViewModel()
    @State private var reachability = NetworkReachabilityMonitor()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()
                .allowsHitTesting(false)

            // Always render the current-view branch so the accessibility
            // tree (and the `root.currentView.*` identifier on the ZStack
            // below) is consistent from t=0. Issue #276.
            switch appVM.currentView {
            case .auth:
                AuthView(appVM: appVM, launchAuthStatusMessage: appVM.authStatusMessage)
                    .transition(.opacity)

            case .session(let sessionType, let track):
                SessionView(appVM: appVM, sessionType: sessionType, track: track)
                    .transition(.opacity)

            case .buddyHub:
                BuddySessionHubView(appVM: appVM)
                    .transition(.opacity)

            case .buddyCalendar:
                BuddyCalendarView(appVM: appVM, mode: .unified)
                    .transition(.opacity)

            case .buddyCalendarWithBuddy(let buddyId, let buddyUsername):
                BuddyCalendarView(
                    appVM: appVM,
                    mode: .perBuddy(buddyId: buddyId, buddyUsername: buddyUsername)
                )
                .transition(.opacity)

            case .buddySession(let sessionId):
                BuddySessionContainerView(appVM: appVM, sessionId: sessionId)
                    .id(sessionId)
                    .transition(.opacity)

            case .completion(let sessionId, let clientSessionId, let clearPercent, let thoughtCount, let thoughts, let dayNumber, let sessionType, let duration, let bonusSeconds, let attentionLog, let attentionElapsed):
                CompletionView(
                    appVM: appVM,
                    sessionId: sessionId,
                    clientSessionId: clientSessionId,
                    clearPercent: clearPercent,
                    thoughtCount: thoughtCount,
                    thoughts: thoughts,
                    dayNumber: dayNumber,
                    sessionType: sessionType,
                    duration: duration,
                    bonusSeconds: bonusSeconds,
                    attentionLog: attentionLog,
                    attentionElapsed: attentionElapsed
                )
                .transition(.opacity)

            case .breathCounting:
                BreathCountingView(appVM: appVM)
                    .transition(.opacity)

            case .logReason(let date):
                LogReasonView(appVM: appVM, targetDate: date)
                    .transition(.opacity)

            default:
                MainTabView(appVM: appVM)
                    .transition(.opacity)
            }

            // Brand-lockup overlay during cold-start auth check. Sits on top
            // of the current-view branch and dismisses when checkAuth flips
            // isLoading to false.
            if appVM.isLoading {
                ZStack {
                    SPColor.bg.ignoresSafeArea()
                    VStack(spacing: SPSpacing.s2) {
                        Text("Still Point")
                            .font(SPFont.brandTitle)
                            .foregroundStyle(Color(SPColor.fg))
                        Text("ATTENTION TRAINING")
                            .font(SPFont.brandSubtitle)
                            .foregroundStyle(Color(SPColor.fg3))
                            .tracking(4)
                        if let authStatusMessage = appVM.authStatusMessage {
                            Text(authStatusMessage)
                                .font(SPFont.mono(12))
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
                .transition(.opacity)
            }
        }
        // Explicit accessibility marker for UI tests. Putting the identifier
        // on the ZStack itself proved unreliable on iOS 26, while a full-screen
        // SwiftUI accessibility overlay could still confuse XCUITest hit-point
        // resolution. This tiny UIKit marker is queryable but never interactive.
        .overlay(alignment: .topLeading) {
            if isUITestMode {
                AccessibilityMarkerView(
                    identifier: "root.currentView.\(viewAccessibilitySlug)",
                    value: coldStartMetricAccessibilityValue
                )
                .frame(width: 1, height: 1)
                .allowsHitTesting(false)
            }

        }
        .animation(.easeInOut(duration: 0.3), value: appVM.currentView)
        .animation(.easeInOut(duration: 0.2), value: appVM.isLoading)
        .onAppear {
            SessionIdleTimerController.syncSceneForegroundActive(
                appVM: appVM,
                isForegroundActive: scenePhase == .active
            )
        }
        .task {
            reachability.ownerUserIdProvider = { appVM.currentUser?.id }
            await appVM.checkAuth()
            await reachability.flushOfflineQueue(ownerUserId: appVM.currentUser?.id)
        }
        .onChange(of: scenePhase) { _, phase in
            SessionIdleTimerController.syncSceneForegroundActive(
                appVM: appVM,
                isForegroundActive: phase == .active
            )
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
                    await appVM.checkAuth()
                    await reachability.flushOfflineQueue(ownerUserId: appVM.currentUser?.id)
                }
            } else if phase == .inactive || phase == .background {
                // Multi-window: only clear when no scene is foreground-active (issue #87).
                SessionIdleTimerController.applyBackgroundIdleTimerPolicyIfNoForegroundScene()
            }
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
        truthy(ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"])
    }

    private func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
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
