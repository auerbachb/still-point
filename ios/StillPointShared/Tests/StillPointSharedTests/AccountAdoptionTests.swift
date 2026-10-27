import XCTest
@testable import StillPointShared

/// Issue #916 — a window that adopts a different account tears down the previous
/// account's local state before the new one is installed, as web's `adoptUser` does
/// (Issue #868 / PR #903). Re-confirming the same account, or adopting the first
/// account after none, tears nothing down.
///
/// `AppViewModel` has no unit-test target, so these drive the sequencer it adopts
/// through with a recorder standing in for its `currentUser` and `authGeneration`.
@MainActor
final class AccountAdoptionTests: XCTestCase {
    /// Stands in for the view model: the account on screen, the identity generation,
    /// and the order the effects ran in, with what the teardown saw when it ran.
    @MainActor
    private final class Recorder {
        var currentUser: String?
        var generation = 0
        var log: [String] = []
        var teardownSaw: [(user: String?, generation: Int)] = []

        init(currentUser: String? = nil) {
            self.currentUser = currentUser
        }

        @discardableResult
        func adopt(_ incoming: String) -> AccountAdoption {
            AccountAdoption.adopt(
                current: currentUser,
                incoming: incoming,
                advanceGeneration: {
                    generation &+= 1
                    log.append("advance")
                },
                tearDown: {
                    teardownSaw.append((currentUser, generation))
                    log.append("teardown")
                },
                install: {
                    currentUser = incoming
                    log.append("install")
                }
            )
        }

        func signOut() {
            generation &+= 1
            currentUser = nil
        }
    }

    // MARK: - Classification

    func testClassifiesNoAccountAsFirstUser() {
        XCTAssertEqual(AccountAdoption.classify(current: String?.none, incoming: "a"), .firstUser)
    }

    func testClassifiesTheSameIDAsSameAccount() {
        XCTAssertEqual(AccountAdoption.classify(current: "a", incoming: "a"), .sameAccount)
    }

    func testClassifiesAnotherIDAsDifferentAccount() {
        XCTAssertEqual(AccountAdoption.classify(current: "a", incoming: "b"), .differentAccount)
    }

    func testOnlyADifferentAccountRequiresTeardown() {
        XCTAssertTrue(AccountAdoption.differentAccount.requiresTeardown)
        XCTAssertFalse(AccountAdoption.sameAccount.requiresTeardown)
        XCTAssertFalse(AccountAdoption.firstUser.requiresTeardown)
    }

    func testOnlyTheSameAccountLeavesTheGenerationAlone() {
        XCTAssertTrue(AccountAdoption.differentAccount.advancesGeneration)
        XCTAssertTrue(AccountAdoption.firstUser.advancesGeneration)
        XCTAssertFalse(AccountAdoption.sameAccount.advancesGeneration)
    }

    // MARK: - Effects

    /// The #916 case: window 1 shows account A, another window signs in as B, and
    /// window 1's next check hands it B. A's state is torn down, after the generation
    /// moved so nothing it cancels can be written back, and before B is installed.
    func testADifferentAccountTearsDownThePreviousOneBeforeInstalling() {
        let window = Recorder(currentUser: "a")
        window.generation = 4

        let adoption = window.adopt("b")

        XCTAssertEqual(adoption, .differentAccount)
        XCTAssertEqual(window.log, ["advance", "teardown", "install"])
        XCTAssertEqual(window.teardownSaw.count, 1)
        XCTAssertEqual(window.teardownSaw.first?.user, "a", "the teardown runs with the previous account installed")
        XCTAssertEqual(window.teardownSaw.first?.generation, 5, "the teardown runs after the generation moved")
        XCTAssertEqual(window.currentUser, "b")
        XCTAssertEqual(window.generation, 5)
    }

    /// A reconnect refresh or a settings round-trip re-confirms the account on screen.
    /// That is not a transition: an open sit and everything else stay as they are.
    func testTheSameAccountOnlyInstalls() {
        let window = Recorder(currentUser: "a")
        window.generation = 4

        let adoption = window.adopt("a")

        XCTAssertEqual(adoption, .sameAccount)
        XCTAssertEqual(window.log, ["install"])
        XCTAssertTrue(window.teardownSaw.isEmpty)
        XCTAssertEqual(window.generation, 4)
    }

    /// A cold start adopts the first account after none. There is nothing to tear down.
    func testTheFirstAccountAdvancesAndInstallsWithoutTeardown() {
        let window = Recorder()

        let adoption = window.adopt("a")

        XCTAssertEqual(adoption, .firstUser)
        XCTAssertEqual(window.log, ["advance", "install"])
        XCTAssertTrue(window.teardownSaw.isEmpty)
        XCTAssertEqual(window.currentUser, "a")
    }

    /// Signing out tears the account down on its own path, so signing back in as the
    /// same account is a first adoption and tears nothing down a second time.
    func testSigningBackInAfterASignOutIsAFirstAdoption() {
        let window = Recorder(currentUser: "a")

        window.signOut()
        let adoption = window.adopt("a")

        XCTAssertEqual(adoption, .firstUser)
        XCTAssertTrue(window.teardownSaw.isEmpty)
    }

    /// Once B is installed, re-confirming B is the same account again: the previous
    /// account is torn down exactly once.
    func testTheReplacedAccountIsTornDownOnce() {
        let window = Recorder(currentUser: "a")

        window.adopt("b")
        window.adopt("b")

        XCTAssertEqual(window.log, ["advance", "teardown", "install", "install"])
        XCTAssertEqual(window.teardownSaw.count, 1)
        XCTAssertEqual(window.teardownSaw.first?.user, "a")
    }
}
