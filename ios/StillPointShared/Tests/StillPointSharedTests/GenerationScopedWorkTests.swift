import Foundation
import Testing
@testable import StillPointShared

/// The account on screen, as far as a finished sit's save is concerned: which
/// identity generation is live, and what a settled save changed for it. Main-actor
/// isolated, like `AppViewModel`, whose `authGeneration` this stands in for.
@MainActor
private final class AccountScreen {
    private(set) var generation = 1
    /// The sits whose completion screen a settled save opened.
    private(set) var completionsOpened: [String] = []
    /// `AppViewModel.localSaveFailed`, the not-saved warning.
    private(set) var localSaveFailed = false

    /// A sign-out and a sign-in each move the generation, as `applySignedOut` /
    /// `didLogout` and `applyAuthenticatedUser` do. Signing back in as the same
    /// account moves it too.
    func signOut() { generation += 1 }
    func signIn() { generation += 1 }

    /// What `SessionViewModel.completeSit(appVM:startedAtGeneration:)` does with a
    /// save once it settles.
    func show(_ outcome: SessionCompletionLogic.SaveOutcome, sit: String) {
        if let failed = SessionCompletionLogic.localSaveFailed(after: outcome) {
            localSaveFailed = failed
        }
        if outcome == .stored {
            completionsOpened.append(sit)
        }
    }
}

/// Issue #854: a sit's save awaits the server flush, so a sign-out and a sign-in can
/// land before it settles. Everything after the save belongs to the account that sat:
/// the completion screen, the practice credit and the not-saved warning. Each test
/// holds a save open across a generation change and checks what the late result may
/// still do. Without the generation check in `GenerationScopedWork.run`, every
/// discard below would apply.
@MainActor
struct GenerationScopedWorkTests {
    /// Ends a sit the way both call sites do: the generation is captured before the
    /// save, and the screen's own generation is read once the save settles.
    private func endSit(
        _ sit: String,
        on screen: AccountScreen,
        saving save: HeldSave<SessionCompletionLogic.SaveOutcome>
    ) -> Task<GenerationScopedWork.Outcome, Never> {
        let generation = screen.generation
        return Task {
            await GenerationScopedWork.run(startedAt: generation, liveGeneration: { screen.generation }) {
                await save.perform()
            } apply: { outcome in
                screen.show(outcome, sit: sit)
            }
        }
    }

    /// With no sign-out in the window, the sit goes on to its completion screen as
    /// before.
    @Test func testASaveThatSettlesForTheSameAccountApplies() async {
        let screen = AccountScreen()
        let save = HeldSave(settlingWith: SessionCompletionLogic.SaveOutcome.stored)
        let ending = endSit("sit-a", on: screen, saving: save)
        await save.untilStarted()

        save.settle()

        let outcome = await ending.value
        #expect(outcome == .applied)
        #expect(screen.completionsOpened == ["sit-a"])
    }

    /// Problem 3: the previous account's sit must not open its completion screen,
    /// and credit itself, for whoever signed in while it was saving.
    @Test func testASaveThatSettlesAfterASignOutAndASignInOpensNothing() async {
        let screen = AccountScreen()
        let save = HeldSave(settlingWith: SessionCompletionLogic.SaveOutcome.stored)
        let ending = endSit("sit-a", on: screen, saving: save)
        await save.untilStarted()

        screen.signOut()
        screen.signIn()
        save.settle()

        let outcome = await ending.value
        #expect(outcome == .discarded)
        #expect(screen.completionsOpened == [])
    }

    /// A sign-out alone is enough. The sign-in screen is up when the save settles, and
    /// the completion screen must not open over it.
    @Test func testASaveThatSettlesAfterASignOutAloneOpensNothing() async {
        let screen = AccountScreen()
        let save = HeldSave(settlingWith: SessionCompletionLogic.SaveOutcome.stored)
        let ending = endSit("sit-a", on: screen, saving: save)
        await save.untilStarted()

        screen.signOut()
        save.settle()

        let outcome = await ending.value
        #expect(outcome == .discarded)
        #expect(screen.completionsOpened == [])
    }

    /// A failed save is scoped like a successful one. The previous account's refused
    /// write must not raise the not-saved warning for the next account.
    @Test func testAFailedSaveThatSettlesAfterASignOutLeavesTheNextAccountsWarningDown() async {
        let screen = AccountScreen()
        let save = HeldSave(settlingWith: SessionCompletionLogic.SaveOutcome.notStored)
        let ending = endSit("sit-a", on: screen, saving: save)
        await save.untilStarted()

        screen.signOut()
        screen.signIn()
        save.settle()

        let outcome = await ending.value
        #expect(outcome == .discarded)
        #expect(!screen.localSaveFailed)
    }

    /// The other direction. The next account's own save failed while the previous
    /// account's was still in flight. The old success must not clear the warning
    /// that is now about the next account's sit.
    @Test func testASuccessfulSaveThatSettlesAfterASignOutLeavesTheNextAccountsWarningUp() async {
        let screen = AccountScreen()
        let earlier = HeldSave(settlingWith: SessionCompletionLogic.SaveOutcome.stored)
        let earlierEnding = endSit("sit-a", on: screen, saving: earlier)
        await earlier.untilStarted()

        screen.signOut()
        screen.signIn()
        let later = HeldSave(settlingWith: SessionCompletionLogic.SaveOutcome.notStored)
        let laterEnding = endSit("sit-b", on: screen, saving: later)
        later.settle()
        let laterOutcome = await laterEnding.value
        #expect(laterOutcome == .applied)
        #expect(screen.localSaveFailed)

        earlier.settle()

        let earlierOutcome = await earlierEnding.value
        #expect(earlierOutcome == .discarded)
        #expect(screen.localSaveFailed, "the previous account's save cleared the next account's warning")
        #expect(screen.completionsOpened == [])
    }

    /// Only the screen is spared, never the sit. A real `SessionSyncCoordinator` save
    /// is held open in `flushEntry`, the suspension point #854 names, with the queue
    /// entry already written. The late result is discarded, and the entry still syncs
    /// under the account that sat.
    @Test func testADiscardedSaveStillKeepsAndSyncsTheSitUnderTheAccountThatSat() async throws {
        let store = InMemoryOfflineSessionQueueStore()
        let upload = HeldSave(settlingWith: ())
        let transport = SessionSyncTransport(
            createSession: { request in
                await upload.perform()
                return SessionSyncCoordinator.sessionDTO(from: request, id: "server-sit-a")
            },
            batchThoughts: { _ in [] }
        )
        let coordinator = SessionSyncCoordinator(queueStore: store, transport: transport)
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 4,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 90,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-10-26",
            clientSessionId: clientSessionId
        )
        let screen = AccountScreen()
        let generation = screen.generation

        let ending = Task {
            await GenerationScopedWork.run(
                startedAt: generation,
                liveGeneration: { screen.generation }
            ) { () async -> SessionCompletionLogic.SaveOutcome in
                do {
                    _ = try await coordinator.saveCompletedSession(
                        request: request,
                        clientSessionId: clientSessionId,
                        ownerUserId: "user-a",
                        thoughts: []
                    )
                    return .stored
                } catch {
                    return .notStored
                }
            } apply: { outcome in
                screen.show(outcome, sit: "sit-a")
            }
        }
        await upload.untilStarted()
        let queuedBeforeUpload = try store.loadEntries().map(\.clientSessionId)
        #expect(queuedBeforeUpload == [clientSessionId])

        screen.signOut()
        screen.signIn()
        upload.settle()

        let outcome = await ending.value
        #expect(outcome == .discarded)
        #expect(screen.completionsOpened == [])
        let entry = try #require(store.loadEntries().first)
        #expect(entry.ownerUserId == "user-a")
        #expect(entry.sessionSynced)
        #expect(entry.serverSessionId == "server-sit-a")
    }
}
