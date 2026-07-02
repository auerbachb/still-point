import XCTest
@testable import StillPointShared

final class AttentionTrackingLogicTests: XCTestCase {
    func testClassifyGazeAttentiveWhenLookingAtDevice() {
        XCTAssertEqual(
            AttentionTrackingLogic.classifyGaze(lookAtX: 0.02, lookAtY: -0.03, lookAtZ: -0.25),
            "attentive"
        )
    }

    func testClassifyGazeAwayWhenLookingOffScreen() {
        XCTAssertEqual(
            AttentionTrackingLogic.classifyGaze(lookAtX: 0.4, lookAtY: 0.0, lookAtZ: -0.25),
            "away"
        )
        XCTAssertEqual(
            AttentionTrackingLogic.classifyGaze(lookAtX: 0.0, lookAtY: 0.0, lookAtZ: 0.1),
            "away"
        )
    }

    func testSustainedThresholdFiltersBriefNoise() {
        var state = AttentionTrackingLogic.SustainedState()

        state = AttentionTrackingLogic.applyRawSample("away", elapsed: 1.0, now: 0.0, state: state)
        XCTAssertEqual(state.loggedState, "attentive")
        XCTAssertEqual(state.pendingState, "away")

        state = AttentionTrackingLogic.applyRawSample("away", elapsed: 1.2, now: 0.3, state: state)
        XCTAssertEqual(state.loggedState, "attentive")
        XCTAssertEqual(state.log.count, 1)

        state = AttentionTrackingLogic.applyRawSample("away", elapsed: 1.6, now: 0.55, state: state)
        XCTAssertEqual(state.loggedState, "away")
        XCTAssertEqual(state.log.count, 2)
        XCTAssertEqual(state.log.last?.time, 1.6)
        XCTAssertEqual(state.log.last?.state, "away")
    }

    func testSustainedThresholdIsHalfSecond() {
        XCTAssertEqual(AttentionTrackingLogic.sustainedThreshold, 0.5, accuracy: 0.001)
    }
}
