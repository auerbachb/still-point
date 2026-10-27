import XCTest
@testable import StillPointShared

/// Issue #851 — the five account-backed Settings controls share one save round trip,
/// and what each control shows afterwards depends on how that round trip ended. The
/// tests pin the one ending #851 changes, a save dropped because the account changed
/// before it was sent, and pin every other ending to what it did before.
///
/// Issue #888 extends that to a camera or microphone prompt answered "no" after the
/// account changed while it was up: the gate leaves the control alone, and the save
/// ends as an identity change. The tests pin that decision, and pin a "no" for the
/// account that asked to the reset and alert it got before.
///
/// The account stands in as a name: the decision only has to hand back whichever
/// account it was given.
final class SettingsControlSaveTests: XCTestCase {
    private let accountA = "account A"
    private let accountB = "account B"

    private func recovery(
        _ ending: SettingsControlSave.Ending,
        accountOnScreen: String?
    ) -> SettingsControlSave.Recovery<String> {
        SettingsControlSave.recovery(after: ending, accountOnScreen: accountOnScreen)
    }

    /// A "no" played through the same two steps as the app: the gate's decision gives
    /// the save its ending, and the ending gives the control its recovery.
    private func denied(
        promptedAt: Int,
        answeredAt: Int,
        accountOnScreen: String?
    ) -> (gate: SettingsControlSave.Denial, control: SettingsControlSave.Recovery<String>) {
        let gate = SettingsControlSave.denial(promptedAt: promptedAt, answeredAt: answeredAt)
        return (gate, recovery(gate.ending, accountOnScreen: accountOnScreen))
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

    /// #888, the half that does not change. The user turns gaze tracking or ambient
    /// sound on and denies the prompt while the same account stays signed in. The gate
    /// turns the toggle back off and raises its alert, the save ends `.notAuthorized`,
    /// and the round trip leaves the gate's reset in place, as before.
    func testADenialForTheAccountThatAskedStillResetsTheControlAndRaisesTheAlert() {
        let outcome = denied(promptedAt: 1, answeredAt: 1, accountOnScreen: accountA)
        XCTAssertEqual(outcome.gate, .resetAndAlert)
        XCTAssertEqual(outcome.gate.ending, .notAuthorized)
        XCTAssertEqual(outcome.control, .keep)
    }

    /// The #888 race. The user turns a toggle on under account A, and its camera or
    /// microphone prompt goes up. Account B is adopted while the prompt is on screen,
    /// and the user then denies it. B never made the change, so the gate must leave the
    /// toggle and its alert alone, and the save must end as an identity change so the
    /// toggle takes B's value. Before #888 the gate turned it off and the round trip
    /// kept that, so a toggle B has on showed off.
    func testADenialAfterAnAccountSwitchResyncsFromTheAccountNowOnScreenWithNoAlert() {
        let outcome = denied(promptedAt: 1, answeredAt: 2, accountOnScreen: accountB)
        XCTAssertEqual(outcome.gate, .leaveForRecovery)
        XCTAssertEqual(outcome.gate.ending, .identityChanged)
        XCTAssertEqual(outcome.control, .resync(accountB))
    }

    /// Signing out while the prompt is up moves the generation the same way. No alert
    /// asks for access on behalf of an account that is gone, and with no account to
    /// copy and Settings leaving the screen, the control is left alone.
    func testADenialAfterASignOutRaisesNoAlertAndLeavesTheControlAlone() {
        let outcome = denied(promptedAt: 1, answeredAt: 2, accountOnScreen: nil)
        XCTAssertEqual(outcome.gate, .leaveForRecovery)
        XCTAssertEqual(outcome.control, .keep)
    }

    /// Switching away and back, or signing out and back in as the same account, while
    /// the prompt is up leaves the account ID where it was but moves the generation
    /// twice. The prompt belongs to a session that is gone, so its "no" raises no
    /// alert, and the control takes the value the account itself has.
    func testADenialAfterSwitchingAwayAndBackResyncsFromTheAccountNowOnScreenWithNoAlert() {
        let outcome = denied(promptedAt: 1, answeredAt: 3, accountOnScreen: accountA)
        XCTAssertEqual(outcome.gate, .leaveForRecovery)
        XCTAssertEqual(outcome.control, .resync(accountA))
    }

    /// The gate resets and alerts for exactly the denials the save ends as
    /// `.notAuthorized`, and leaves the control alone for exactly those it ends as an
    /// identity change. A control the gate puts back is never re-synced over, and one
    /// it leaves alone is always handed to `recovery`.
    func testOnlyADenialUnderTheGenerationItWasPromptedUnderResetsAndAlerts() {
        for promptedAt in 0...3 {
            for answeredAt in 0...3 {
                let gate = SettingsControlSave.denial(promptedAt: promptedAt, answeredAt: answeredAt)
                let label = "promptedAt: \(promptedAt), answeredAt: \(answeredAt)"
                XCTAssertEqual(gate == .resetAndAlert, promptedAt == answeredAt, label)
                XCTAssertEqual(gate.ending == .notAuthorized, gate == .resetAndAlert, label)
            }
        }
    }

    /// Nothing was sent after a "no", so the round trip never reverts. For the account
    /// that asked, the gate has already put the control back. For any other account,
    /// the value from before the change is the previous account's.
    func testNoDenialRevertsTheControl() {
        for gate in SettingsControlSave.Denial.allCases {
            for accountOnScreen in [accountA, accountB, nil] {
                XCTAssertNotEqual(
                    recovery(gate.ending, accountOnScreen: accountOnScreen),
                    .revert,
                    "\(gate), accountOnScreen: \(accountOnScreen ?? "nil")"
                )
            }
        }
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
