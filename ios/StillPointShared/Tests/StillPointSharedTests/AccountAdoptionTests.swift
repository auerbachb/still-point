import Foundation
import Testing
@testable import StillPointShared

/// Issue #916 — a window that adopts a different account tears down the previous
/// account's local state before the new one is installed, as web's `adoptUser` does
/// (Issue #868 / PR #903). Re-confirming the same account, or adopting the first
/// account after none, tears nothing down.
///
/// `AppViewModel` has no unit-test target, so these drive the sequencer it adopts
/// through with a recorder standing in for its `currentUser` and `authGeneration`.
@MainActor
struct AccountAdoptionTests {
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

    @Test func testClassifiesNoAccountAsFirstUser() {
        #expect(AccountAdoption.classify(current: String?.none, incoming: "a") == .firstUser)
    }

    @Test func testClassifiesTheSameIDAsSameAccount() {
        #expect(AccountAdoption.classify(current: "a", incoming: "a") == .sameAccount)
    }

    @Test func testClassifiesAnotherIDAsDifferentAccount() {
        #expect(AccountAdoption.classify(current: "a", incoming: "b") == .differentAccount)
    }

    @Test func testOnlyADifferentAccountRequiresTeardown() {
        #expect(AccountAdoption.differentAccount.requiresTeardown)
        #expect(!AccountAdoption.sameAccount.requiresTeardown)
        #expect(!AccountAdoption.firstUser.requiresTeardown)
    }

    @Test func testOnlyTheSameAccountLeavesTheGenerationAlone() {
        #expect(AccountAdoption.differentAccount.advancesGeneration)
        #expect(AccountAdoption.firstUser.advancesGeneration)
        #expect(!AccountAdoption.sameAccount.advancesGeneration)
    }

    // MARK: - Effects

    /// The #916 case: window 1 shows account A, another window signs in as B, and
    /// window 1's next check hands it B. A's state is torn down, after the generation
    /// moved so nothing it cancels can be written back, and before B is installed.
    @Test func testADifferentAccountTearsDownThePreviousOneBeforeInstalling() {
        let window = Recorder(currentUser: "a")
        window.generation = 4

        let adoption = window.adopt("b")

        #expect(adoption == .differentAccount)
        #expect(window.log == ["advance", "teardown", "install"])
        #expect(window.teardownSaw.count == 1)
        #expect(window.teardownSaw.first?.user == "a", "the teardown runs with the previous account installed")
        #expect(window.teardownSaw.first?.generation == 5, "the teardown runs after the generation moved")
        #expect(window.currentUser == "b")
        #expect(window.generation == 5)
    }

    /// A reconnect refresh or a settings round-trip re-confirms the account on screen.
    /// That is not a transition: an open sit and everything else stay as they are.
    @Test func testTheSameAccountOnlyInstalls() {
        let window = Recorder(currentUser: "a")
        window.generation = 4

        let adoption = window.adopt("a")

        #expect(adoption == .sameAccount)
        #expect(window.log == ["install"])
        #expect(window.teardownSaw.isEmpty)
        #expect(window.generation == 4)
    }

    /// A cold start adopts the first account after none. There is nothing to tear down.
    @Test func testTheFirstAccountAdvancesAndInstallsWithoutTeardown() {
        let window = Recorder()

        let adoption = window.adopt("a")

        #expect(adoption == .firstUser)
        #expect(window.log == ["advance", "install"])
        #expect(window.teardownSaw.isEmpty)
        #expect(window.currentUser == "a")
    }

    /// Signing out tears the account down on its own path, so signing back in as the
    /// same account is a first adoption and tears nothing down a second time.
    @Test func testSigningBackInAfterASignOutIsAFirstAdoption() {
        let window = Recorder(currentUser: "a")

        window.signOut()
        let adoption = window.adopt("a")

        #expect(adoption == .firstUser)
        #expect(window.teardownSaw.isEmpty)
    }

    /// Once B is installed, re-confirming B is the same account again: the previous
    /// account is torn down exactly once.
    @Test func testTheReplacedAccountIsTornDownOnce() {
        let window = Recorder(currentUser: "a")

        window.adopt("b")
        window.adopt("b")

        #expect(window.log == ["advance", "teardown", "install", "install"])
        #expect(window.teardownSaw.count == 1)
        #expect(window.teardownSaw.first?.user == "a")
    }
}
