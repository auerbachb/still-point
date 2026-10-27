import Foundation
import Testing
@testable import StillPointShared

struct AttentionTrackingLogicTests {
    @Test func testClassifyGazeAttentiveWhenLookingAtDevice() {
        // Positive Z = toward device (Apple-documented ARFaceAnchor convention).
        #expect(AttentionTrackingLogic.classifyGaze(lookAtX: 0.02, lookAtY: -0.03, lookAtZ: 0.25) == "attentive")
    }

    @Test func testClassifyGazeAwayWhenLookingOffScreen() {
        // Toward device but X is too far off-center.
        #expect(AttentionTrackingLogic.classifyGaze(lookAtX: 0.4, lookAtY: 0.0, lookAtZ: 0.25) == "away")
        // Negative Z = gaze directed away from the device entirely.
        #expect(AttentionTrackingLogic.classifyGaze(lookAtX: 0.0, lookAtY: 0.0, lookAtZ: -0.25) == "away")
    }

    @Test func testSustainedThresholdFiltersBriefNoise() {
        var state = AttentionTrackingLogic.SustainedState()

        state = AttentionTrackingLogic.applyRawSample("away", elapsed: 1.0, now: 0.0, state: state)
        #expect(state.loggedState == "attentive")
        #expect(state.pendingState == "away")

        state = AttentionTrackingLogic.applyRawSample("away", elapsed: 1.2, now: 0.3, state: state)
        #expect(state.loggedState == "attentive")
        #expect(state.log.count == 0)

        state = AttentionTrackingLogic.applyRawSample("away", elapsed: 1.6, now: 0.55, state: state)
        #expect(state.loggedState == "away")
        #expect(state.log.count == 1)
        #expect(state.log.last?.time == 1.6)
        #expect(state.log.last?.state == "away")
    }

    @Test func testSustainedThresholdIsHalfSecond() {
        #expect(abs(AttentionTrackingLogic.sustainedThreshold - 0.5) <= 0.001)
    }
}
