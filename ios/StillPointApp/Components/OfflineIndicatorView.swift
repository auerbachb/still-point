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
///
/// #717: that failure is not a connectivity failure, so the strip also has to be
/// able to raise itself while online — which means the `wifi.slash` glyph has to
/// go with the copy. It is the loudest thing on the strip and says "offline" on
/// its own, so an online failure gets a warning triangle and the glyph never
/// contradicts the label it sits next to.
struct OfflineIndicatorView: View {
    /// Which of the strip's three things to say — resolved by
    /// `OfflineIndicatorCopy.state(offline:sitNotStored:)`, which also decides
    /// whether there is anything to say at all. The caller does not build this
    /// view for `nil`.
    var state: OfflineIndicatorCopy.State

    private var copy: OfflineIndicatorCopy.Copy {
        OfflineIndicatorCopy.copy(for: state)
    }

    private var sitNotStored: Bool { state != .offlineSavedProgress }
    private var offline: Bool { state != .onlineSitNotStored }

    var body: some View {
        HStack(spacing: SPSpacing.s1) {
            Image(systemName: offline ? "wifi.slash" : "exclamationmark.triangle")
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
