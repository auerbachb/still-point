import XCTest
@testable import StillPointShared

/// Issue #851 — the five account-backed Settings controls share one save round trip,
/// and what each control shows afterwards depends on how that round trip ended. The
/// tests pin the one ending #851 changes, a save dropped because the account changed
/// before it was sent, and pin every other ending to what it did before.
///
/// The account stands in as a name: the decision only has to hand back whichever
/// account it was given.
final class SettingsControlSaveTests: XCTestCase {
    private let accountB = "account B"

    private func recovery(
        _ ending: SettingsControlSave.Ending,
        accountOnScreen: String?
    ) -> SettingsControlSave.Recovery<String> {
        SettingsControlSave.recovery(after: ending, accountOnScreen: accountOnScreen)
    }

    /// The #851 race. The user flips a control on account A, and its save waits in
    /// line behind a `me()` read. The read adopts account B while Settings stays on
    /// screen, and the screen's copy of the account skips the control because its save
    /// is still in flight. The save then reaches the identity guard and is dropped
    /// unsent. The control must take B's value. Reverting would put back A's, and
    /// leaving it would keep showing A's unsaved change.
    func testASaveDroppedForAnAccountSwitchResyncsFromTheAccountNowOnScreen() {
        XCTAssertEqual(recovery(.identityChanged, accountOnScreen: accountB), .resync(accountB))
    }

    /// Signing out while a save waits in line drops it at the same guard. There is no
    /// account to copy and Settings is leaving the screen, so the control is left
    /// alone, as it was before #851.
    func testASaveDroppedBySignOutLeavesTheControlAlone() {
        XCTAssertEqual(recovery(.identityChanged, accountOnScreen: nil), .keep)
    }

    /// A request that throws puts the control back, signed in or not. Unchanged.
    func testAFailedRequestRevertsTheControl() {
        XCTAssertEqual(recovery(.failed, accountOnScreen: accountB), .revert)
        XCTAssertEqual(recovery(.failed, accountOnScreen: nil), .revert)
    }

    /// Issue #745, step 6: signing out while the request is in flight discards its
    /// response, and the control goes back. A discarded response with an account
    /// still signed in gets the same answer. Unchanged.
    func testADiscardedResponseRevertsTheControl() {
        XCTAssertEqual(recovery(.discarded, accountOnScreen: nil), .revert)
        XCTAssertEqual(recovery(.discarded, accountOnScreen: accountB), .revert)
    }

    /// An adopted response already describes what the control shows, and a superseded
    /// one was still taken by the server. Neither touches the control. Unchanged.
    func testAnAdoptedOrSupersededResponseLeavesTheControlAlone() {
        for accountOnScreen in [accountB, nil] {
            XCTAssertEqual(recovery(.applied, accountOnScreen: accountOnScreen), .keep)
            XCTAssertEqual(recovery(.superseded, accountOnScreen: accountOnScreen), .keep)
        }
    }

    /// A denied camera or microphone prompt, or a device that cannot track gaze, stops
    /// the save before anything is sent. The gate has already put the control back and
    /// raised its alert, so the round trip leaves it alone. Unchanged.
    func testAPermissionGateThatSaidNoLeavesTheControlAlone() {
        XCTAssertEqual(recovery(.notAuthorized, accountOnScreen: accountB), .keep)
        XCTAssertEqual(recovery(.notAuthorized, accountOnScreen: nil), .keep)
    }

    /// #851 adds one answer and moves no other ending onto it: only a save dropped for
    /// an account switch, with an account still on screen, resyncs.
    func testOnlyASaveDroppedWithAnAccountOnScreenResyncs() {
        for ending in SettingsControlSave.Ending.allCases {
            for accountOnScreen in [accountB, nil] {
                let resyncs: Bool
                if case .resync = recovery(ending, accountOnScreen: accountOnScreen) {
                    resyncs = true
                } else {
                    resyncs = false
                }
                XCTAssertEqual(
                    resyncs,
                    ending == .identityChanged && accountOnScreen != nil,
                    "\(ending), accountOnScreen: \(accountOnScreen ?? "nil")"
                )
            }
        }
    }
}
