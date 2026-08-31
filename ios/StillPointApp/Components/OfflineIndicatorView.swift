import SwiftUI
import StillPointShared

/// #665: the unobtrusive strip shown while the app is running from its local copy
/// of identity and state.
///
/// Deliberately not an error in its usual state. There is nothing to act on and
/// nothing to dismiss — the sit still runs, the day number is still right, and
/// the completion still saves. It replaces what a lost connection used to
/// produce: a sign-in screen nobody asked for, with "Connection failed. Please
/// try again." on it. Amber, not red, for the same reason.
///
/// #703 is the one case where that reassurance would be a lie: a refused local
/// write means the sit is on no device and will upload nowhere. The strip then
/// carries the withdrawn copy — from the shared `OfflineIndicatorCopy`, so it
/// stays word-for-word with the web strip — in danger tokens instead.
struct OfflineIndicatorView: View {
    /// A local queue write has failed and has not since succeeded.
    var sitNotStored: Bool = false

    private var copy: OfflineIndicatorCopy.Copy {
        OfflineIndicatorCopy.copy(for: OfflineIndicatorCopy.state(sitNotStored: sitNotStored))
    }

    var body: some View {
        HStack(spacing: SPSpacing.s1) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 10, weight: .medium))
            Text(copy.label)
                .font(SPFont.mono(10, weight: .medium))
                .tracking(2)
        }
        .foregroundStyle(sitNotStored ? SPColor.danger : SPColor.amberText)
        .padding(.vertical, SPSpacing.s1)
        .frame(maxWidth: .infinity)
        .background(SPColor.amberBgFaint)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(sitNotStored ? SPColor.dangerBorderSubtle : SPColor.amberBorderSubtle)
                .frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("app.offlineIndicator")
        .accessibilityLabel(copy.accessibilityLabel)
    }
}
