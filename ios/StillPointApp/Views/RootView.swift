import SwiftUI
import StillPointShared
import UIKit

struct RootView: View {
    @State private var appVM = AppViewModel()
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

            case .session(let sessionType):
                SessionView(appVM: appVM, sessionType: sessionType)
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

            case .completion(let sessionId, let clearPercent, let thoughtCount, let thoughts, let dayNumber, let sessionType, let duration, let bonusSeconds):
                CompletionView(
                    appVM: appVM,
                    sessionId: sessionId,
                    clearPercent: clearPercent,
                    thoughtCount: thoughtCount,
                    thoughts: thoughts,
                    dayNumber: dayNumber,
                    sessionType: sessionType,
                    duration: duration,
                    bonusSeconds: bonusSeconds
                )
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
            PushNotificationCoordinator.shared.deepLinkHandler = { url in
                appVM.handleIncomingURL(url)
            }
            SessionIdleTimerController.syncSceneForegroundActive(
                appVM: appVM,
                isForegroundActive: scenePhase == .active
            )
        }
        .task {
            await appVM.checkAuth()
        }
        .onChange(of: scenePhase) { _, phase in
            SessionIdleTimerController.syncSceneForegroundActive(
                appVM: appVM,
                isForegroundActive: phase == .active
            )
            if phase == .active {
                appVM.appBlockingManager.refreshShielding()
                SessionIdleTimerController.applyDesiredIdleTimerState()
            } else if phase == .inactive || phase == .background {
                // Multi-window: only clear when no scene is foreground-active (issue #87).
                SessionIdleTimerController.applyBackgroundIdleTimerPolicyIfNoForegroundScene()
            }
        }
        .onOpenURL { url in
            appVM.handleIncomingURL(url)
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
