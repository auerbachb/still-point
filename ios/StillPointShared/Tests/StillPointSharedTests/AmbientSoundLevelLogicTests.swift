import Foundation
import Testing
@testable import StillPointShared

struct AmbientSoundLevelLogicTests {

    // MARK: - RMS

    @Test func testRMSEmptyBuffer() {
        #expect(AmbientSoundLevelLogic.rms(from: []) == 0)
    }

    @Test func testRMSSilence() {
        #expect(AmbientSoundLevelLogic.rms(from: [0, 0, 0]) == 0)
    }

    @Test func testRMSFullScale() {
        // Full-scale 1.0 samples → RMS = 1.0
        #expect(abs(AmbientSoundLevelLogic.rms(from: [1.0, 1.0]) - 1.0) <= 1e-6)
    }

    @Test func testRMSKnownValue() {
        // [0.5, 0.5]: sum of squares = 0.25 + 0.25 = 0.5, mean = 0.25, sqrt = 0.5
        #expect(abs(AmbientSoundLevelLogic.rms(from: [0.5, 0.5]) - 0.5) <= 1e-6)
    }

    @Test func testRMSMixedSigns() {
        // Signs cancel in the squared sum: [1.0, -1.0] → RMS = 1.0
        #expect(abs(AmbientSoundLevelLogic.rms(from: [1.0, -1.0]) - 1.0) <= 1e-6)
    }

    // MARK: - dBFS conversion

    @Test func testToDBFSZeroRMS() {
        #expect(AmbientSoundLevelLogic.toDBFS(rms: 0) == AmbientSoundLevelLogic.silenceFloorDB)
    }

    @Test func testToDBFSFullScale() {
        // 1.0 amplitude → 0 dBFS
        #expect(abs(AmbientSoundLevelLogic.toDBFS(rms: 1.0) - 0.0) <= 1e-6)
    }

    @Test func testToDBFSHalfAmplitude() {
        // 0.5 amplitude → ~-6.02 dBFS
        let db = AmbientSoundLevelLogic.toDBFS(rms: 0.5)
        #expect(abs(db - -6.0206) <= 0.001)
    }

    @Test func testToDBFSClampsToFloor() {
        // Very small RMS that would compute below the silence floor
        let db = AmbientSoundLevelLogic.toDBFS(rms: 1e-20)
        #expect(db >= AmbientSoundLevelLogic.silenceFloorDB)
    }

    // MARK: - Quiet/Loud classification

    @Test func testIsQuietBelowThreshold() {
        #expect(AmbientSoundLevelLogic.isQuiet(levelDB: -50.0))
    }

    @Test func testIsLoudAtThreshold() {
        let threshold = AmbientSoundLevelLogic.quietLoudThresholdDB
        // At exactly the threshold it is NOT quiet (loud side)
        #expect(!AmbientSoundLevelLogic.isQuiet(levelDB: threshold))
    }

    @Test func testIsLoudAboveThreshold() {
        #expect(!AmbientSoundLevelLogic.isQuiet(levelDB: -10.0))
    }

    @Test func testCustomThreshold() {
        #expect(AmbientSoundLevelLogic.isQuiet(levelDB: -55.0, threshold: -50.0))
        #expect(!AmbientSoundLevelLogic.isQuiet(levelDB: -50.0, threshold: -55.0))
    }

    // MARK: - Accumulator: empty

    @Test func testAccumulatorNoSamplesReturnsNil() {
        let acc = AmbientSoundLevelLogic.Accumulator()
        #expect(acc.summary() == nil)
    }

    // MARK: - Accumulator: all quiet

    @Test func testAccumulatorAllQuiet() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -60.0)
        acc.ingest(levelDB: -55.0)
        acc.ingest(levelDB: -41.0) // just below -40 threshold → quiet

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(summary.sampleCount == 3)
        #expect(summary.quietPercent == 100)
        #expect(summary.loudPercent == 0)
        // Peak should be the highest dBFS: -41.0
        #expect(abs(summary.peakDb - -41.0) <= 1e-6)
    }

    // MARK: - Accumulator: all loud

    @Test func testAccumulatorAllLoud() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -20.0)
        acc.ingest(levelDB: -10.0)
        acc.ingest(levelDB: -5.0)

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(summary.sampleCount == 3)
        #expect(summary.quietPercent == 0)
        #expect(summary.loudPercent == 100)
        #expect(abs(summary.peakDb - -5.0) <= 1e-6)
    }

    // MARK: - Accumulator: mixed

    @Test func testAccumulatorMixedQuietLoud() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -60.0) // quiet
        acc.ingest(levelDB: -30.0) // loud
        acc.ingest(levelDB: -50.0) // quiet
        acc.ingest(levelDB: -20.0) // loud

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(summary.sampleCount == 4)
        #expect(summary.quietPercent == 50)
        #expect(summary.loudPercent == 50)
    }

    @Test func testAccumulatorAverageDB() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -60.0)
        acc.ingest(levelDB: -40.0)

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(abs(summary.avgDb - -50.0) <= 1e-6)
    }

    @Test func testAccumulatorPeakTracking() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -70.0)
        acc.ingest(levelDB: -20.0)
        acc.ingest(levelDB: -50.0)

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(abs(summary.peakDb - -20.0) <= 1e-6)
    }

    @Test func testAccumulatorSingleSample() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -35.0) // above -40 threshold → loud

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(summary.sampleCount == 1)
        #expect(abs(summary.avgDb - -35.0) <= 1e-6)
        #expect(abs(summary.peakDb - -35.0) <= 1e-6)
        #expect(summary.quietPercent == 0)
        #expect(summary.loudPercent == 100)
    }

    // MARK: - End-to-end: rms → dBFS → accumulate → summarize

    @Test func testEndToEndSilentSession() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        let silentBuffer: [Float] = Array(repeating: 0, count: 1024)
        let rms = AmbientSoundLevelLogic.rms(from: silentBuffer)
        let db = AmbientSoundLevelLogic.toDBFS(rms: rms)
        acc.ingest(levelDB: db)

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(abs(summary.avgDb - AmbientSoundLevelLogic.silenceFloorDB) <= 1e-6)
        #expect(summary.quietPercent == 100)
    }

    @Test func testEndToEndFullScaleSession() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        let fullBuffer: [Float] = Array(repeating: 1.0, count: 512)
        let rms = AmbientSoundLevelLogic.rms(from: fullBuffer)
        let db = AmbientSoundLevelLogic.toDBFS(rms: rms)
        acc.ingest(levelDB: db)

        guard let summary = acc.summary() else {
            Issue.record("Expected non-nil summary"); return
        }
        #expect(abs(summary.avgDb - 0.0) <= 1e-6) // 0 dBFS
        #expect(summary.loudPercent == 100) // 0 dBFS >> -40 threshold
    }

    // MARK: - Equatable

    @Test func testAccumulatorEquatable() {
        var acc1 = AmbientSoundLevelLogic.Accumulator()
        var acc2 = AmbientSoundLevelLogic.Accumulator()
        acc1.ingest(levelDB: -50.0)
        acc2.ingest(levelDB: -50.0)
        #expect(acc1 == acc2)
    }
}
