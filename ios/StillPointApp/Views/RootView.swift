import SwiftUI
import StillPointShared

struct RootView: View {
    @State private var appVM = AppViewModel()

    var body: some View {
        ZStack {
            SPColor.bg.ignoresSafeArea()

            // Always render the current-view branch so the accessibility
            // tree (and the `root.currentView.*` identifier on the ZStack
            // below) is consistent from t=0. Issue #276: previously this
            // branch was gated behind `if !isLoading`, so during the cold-
            // start window the ZStack only contained two static Text views
            // and the UI test could not find `root.currentView.auth` as an
            // `otherElements` match — every test except the first
            // seedAuth=true smoke test timed out at 30s.
            switch appVM.currentView {
            case .auth:
                AuthView(appVM: appVM, launchAuthStatusMessage: appVM.authStatusMessage)
                    .transition(.opacity)

            case .session:
                SessionView(appVM: appVM)
                    .transition(.opacity)

            case .buddyHub:
                BuddySessionHubView(appVM: appVM)
                    .transition(.opacity)

            case .buddySession(let sessionId):
                BuddySessionContainerView(appVM: appVM, sessionId: sessionId)
                    .id(sessionId)
                    .transition(.opacity)

            case .completion(let sessionId, let clearPercent, let thoughtCount, let thoughts, let dayNumber, let duration):
                CompletionView(
                    appVM: appVM,
                    sessionId: sessionId,
                    clearPercent: clearPercent,
                    thoughtCount: thoughtCount,
                    thoughts: thoughts,
                    dayNumber: dayNumber,
                    duration: duration
                )
                .transition(.opacity)

            default:
                MainTabView(appVM: appVM)
                    .transition(.opacity)
            }

            // Brand-lockup overlay during cold-start auth check. Sits on top
            // of the current-view branch and dismisses when checkAuth flips
            // isLoading to false.
            //
            // CRITICAL: `.allowsHitTesting(false)` lets taps fall through to
            // the AuthView/MainTabView layer underneath. Without it, the
            // full-screen `SPColor.bg` participates in hit testing and
            // XCUITest sees "Computed hit point {-1, -1}" on
            // `auth.emailField`, even though the field exists in the
            // accessibility tree (issue #276 round 4 — round 3 fixed
            // existence; this fixes hittability).
            //
            // `.accessibilityHidden(true)` is orthogonal — it removes the
            // overlay from VoiceOver / XCUITest's tree but does NOT disable
            // hit testing. Both are needed.
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
        // Explicit accessibility marker for UI tests. Putting the
        // identifier on the ZStack itself proved unreliable on iOS 26 —
        // SwiftUI containers without an `.accessibilityElement` promotion
        // are not surfaced consistently as `XCUIElementType.other` matches
        // for `app.otherElements[...]`. A separate Color.clear overlay
        // marked as an explicit accessibility element gives the test a
        // dedicated, full-screen .other node that does not depend on
        // child-coalescing heuristics. Issue #276.
        .overlay(accessibilityMarker.allowsHitTesting(false))
        .animation(.easeInOut(duration: 0.3), value: appVM.currentView)
        .animation(.easeInOut(duration: 0.2), value: appVM.isLoading)
        .task {
            await appVM.checkAuth()
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

    /// Always-visible, full-screen, invisible accessibility marker that
    /// carries the `root.currentView.<slug>` identifier used by the UI
    /// tests. Color.clear with `.accessibilityElement()` reliably surfaces
    /// as an `XCUIElementType.other` node, unlike a bare ZStack with
    /// `.accessibilityIdentifier`. Issue #276.
    private var accessibilityMarker: some View {
        Color.clear
            .ignoresSafeArea()
            .accessibilityElement()
            .accessibilityIdentifier("root.currentView.\(viewAccessibilitySlug)")
            .accessibilityValue(coldStartMetricAccessibilityValue)
    }
}
