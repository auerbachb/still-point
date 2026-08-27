import SwiftUI

/// #665: the unobtrusive strip shown while the app is running from its local copy
/// of identity and state.
///
/// Deliberately not an error. There is nothing to act on and nothing to dismiss —
/// the sit still runs, the day number is still right, and the completion still
/// saves. It replaces what a lost connection used to produce: a sign-in screen
/// nobody asked for, with "Connection failed. Please try again." on it. Amber, not
/// red, for the same reason.
struct OfflineIndicatorView: View {
    var body: some View {
        HStack(spacing: SPSpacing.s1) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 10, weight: .medium))
            Text("OFFLINE · SAVED PROGRESS")
                .font(SPFont.mono(10, weight: .medium))
                .tracking(2)
        }
        .foregroundStyle(SPColor.amberText)
        .padding(.vertical, SPSpacing.s1)
        .frame(maxWidth: .infinity)
        .background(SPColor.amberBgFaint)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(SPColor.amberBorderSubtle)
                .frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("app.offlineIndicator")
        .accessibilityLabel("Offline. Showing your saved progress; sits are saved and upload when you reconnect.")
    }
}
