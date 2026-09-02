import XCTest
@testable import StillPointShared

/// Records what the queue actually did. Main-actor isolated, so it is `Sendable`
/// without any unchecked escape hatch and the counters below cannot race.
@MainActor
private final class QueueRecorder {
    private(set) var finished: [Int] = []
    private(set) var peakConcurrency = 0
    private var running = 0

    func begin() {
        running += 1
        peakConcurrency = max(peakConcurrency, running)
    }

    func end(_ id: Int) {
        running -= 1
        finished.append(id)
    }
}

/// A settings mutation is a network round trip, so every operation here suspends
/// several times: a queue that only looks serial because nothing yielded would prove
/// nothing.
private func simulateRoundTrip(yields: Int) async {
    for _ in 0..<yields { await Task.yield() }
}

@MainActor
final class SettingsWriteQueueTests: XCTestCase {
    /// The point of the whole exercise: the server sees the mutations in the order
    /// the user made them, even when an earlier one is much slower than a later one.
    func testRunsOperationsInEnqueueOrderEvenWhenTheFirstIsSlowest() async {
        let queue = SettingsWriteQueue()
        let recorder = QueueRecorder()

        queue.enqueue {
            recorder.begin()
            await simulateRoundTrip(yields: 8)
            recorder.end(1)
        }
        queue.enqueue {
            recorder.begin()
            await simulateRoundTrip(yields: 4)
            recorder.end(2)
        }
        let last = queue.enqueue {
            recorder.begin()
            recorder.end(3)
        }

        await last.value
        XCTAssertEqual(recorder.finished, [1, 2, 3])
    }

    /// No two settings writes are ever in flight together, which is what makes each
    /// response a complete picture of the account and removes the need to hold the
    /// value a response confirmed.
    func testOperationsNeverOverlap() async {
        let queue = SettingsWriteQueue()
        let recorder = QueueRecorder()

        var last: Task<Void, Never>?
        for id in 1...5 {
            last = queue.enqueue {
                recorder.begin()
                await simulateRoundTrip(yields: 6 - id)
                recorder.end(id)
            }
        }

        await last?.value
        XCTAssertEqual(recorder.peakConcurrency, 1)
        XCTAssertEqual(recorder.finished, [1, 2, 3, 4, 5])
    }

    /// A write that bails out early — a denied camera permission, a failed request —
    /// must not strand the writes queued behind it.
    func testAnOperationThatBailsOutDoesNotStallTheQueue() async {
        let queue = SettingsWriteQueue()
        let recorder = QueueRecorder()

        queue.enqueue {
            recorder.begin()
            recorder.end(1)
            return // as a permission denial does, before any request
        }
        let last = queue.enqueue {
            recorder.begin()
            await simulateRoundTrip(yields: 3)
            recorder.end(2)
        }

        await last.value
        XCTAssertEqual(recorder.finished, [1, 2])
    }

    /// Work enqueued after the queue has drained starts on its own rather than
    /// waiting on a predecessor that already finished.
    func testEnqueuingAfterTheQueueDrainsStillRuns() async {
        let queue = SettingsWriteQueue()
        let recorder = QueueRecorder()

        await queue.enqueue {
            recorder.begin()
            await simulateRoundTrip(yields: 2)
            recorder.end(1)
        }.value

        await queue.enqueue {
            recorder.begin()
            recorder.end(2)
        }.value

        XCTAssertEqual(recorder.finished, [1, 2])
        XCTAssertEqual(recorder.peakConcurrency, 1)
    }
}
