import XCTest
@testable import StillPointShared

final class AmbientSoundLevelLogicTests: XCTestCase {

    // MARK: - RMS

    func testRMSEmptyBuffer() {
        XCTAssertEqual(AmbientSoundLevelLogic.rms(from: []), 0)
    }

    func testRMSSilence() {
        XCTAssertEqual(AmbientSoundLevelLogic.rms(from: [0, 0, 0]), 0)
    }

    func testRMSFullScale() {
        // Full-scale 1.0 samples → RMS = 1.0
        XCTAssertEqual(AmbientSoundLevelLogic.rms(from: [1.0, 1.0]), 1.0, accuracy: 1e-6)
    }

    func testRMSKnownValue() {
        // [0.5, 0.5]: sum of squares = 0.25 + 0.25 = 0.5, mean = 0.25, sqrt = 0.5
        XCTAssertEqual(AmbientSoundLevelLogic.rms(from: [0.5, 0.5]), 0.5, accuracy: 1e-6)
    }

    func testRMSMixedSigns() {
        // Signs cancel in the squared sum: [1.0, -1.0] → RMS = 1.0
        XCTAssertEqual(AmbientSoundLevelLogic.rms(from: [1.0, -1.0]), 1.0, accuracy: 1e-6)
    }

    // MARK: - dBFS conversion

    func testToDBFSZeroRMS() {
        XCTAssertEqual(AmbientSoundLevelLogic.toDBFS(rms: 0),
                       AmbientSoundLevelLogic.silenceFloorDB)
    }

    func testToDBFSFullScale() {
        // 1.0 amplitude → 0 dBFS
        XCTAssertEqual(AmbientSoundLevelLogic.toDBFS(rms: 1.0), 0.0, accuracy: 1e-6)
    }

    func testToDBFSHalfAmplitude() {
        // 0.5 amplitude → ~-6.02 dBFS
        let db = AmbientSoundLevelLogic.toDBFS(rms: 0.5)
        XCTAssertEqual(db, -6.0206, accuracy: 0.001)
    }

    func testToDBFSClampsToFloor() {
        // Very small RMS that would compute below the silence floor
        let db = AmbientSoundLevelLogic.toDBFS(rms: 1e-20)
        XCTAssertGreaterThanOrEqual(db, AmbientSoundLevelLogic.silenceFloorDB)
    }

    // MARK: - Quiet/Loud classification

    func testIsQuietBelowThreshold() {
        XCTAssertTrue(AmbientSoundLevelLogic.isQuiet(levelDB: -50.0))
    }

    func testIsLoudAtThreshold() {
        let threshold = AmbientSoundLevelLogic.quietLoudThresholdDB
        // At exactly the threshold it is NOT quiet (loud side)
        XCTAssertFalse(AmbientSoundLevelLogic.isQuiet(levelDB: threshold))
    }

    func testIsLoudAboveThreshold() {
        XCTAssertFalse(AmbientSoundLevelLogic.isQuiet(levelDB: -10.0))
    }

    func testCustomThreshold() {
        XCTAssertTrue(AmbientSoundLevelLogic.isQuiet(levelDB: -55.0, threshold: -50.0))
        XCTAssertFalse(AmbientSoundLevelLogic.isQuiet(levelDB: -50.0, threshold: -55.0))
    }

    // MARK: - Accumulator: empty

    func testAccumulatorNoSamplesReturnsNil() {
        let acc = AmbientSoundLevelLogic.Accumulator()
        XCTAssertNil(acc.summary())
    }

    // MARK: - Accumulator: all quiet

    func testAccumulatorAllQuiet() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -60.0)
        acc.ingest(levelDB: -55.0)
        acc.ingest(levelDB: -41.0) // just below -40 threshold → quiet

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.sampleCount, 3)
        XCTAssertEqual(summary.quietPercent, 100)
        XCTAssertEqual(summary.loudPercent, 0)
        // Peak should be the highest dBFS: -41.0
        XCTAssertEqual(summary.peakDb, -41.0, accuracy: 1e-6)
    }

    // MARK: - Accumulator: all loud

    func testAccumulatorAllLoud() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -20.0)
        acc.ingest(levelDB: -10.0)
        acc.ingest(levelDB: -5.0)

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.sampleCount, 3)
        XCTAssertEqual(summary.quietPercent, 0)
        XCTAssertEqual(summary.loudPercent, 100)
        XCTAssertEqual(summary.peakDb, -5.0, accuracy: 1e-6)
    }

    // MARK: - Accumulator: mixed

    func testAccumulatorMixedQuietLoud() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -60.0) // quiet
        acc.ingest(levelDB: -30.0) // loud
        acc.ingest(levelDB: -50.0) // quiet
        acc.ingest(levelDB: -20.0) // loud

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.sampleCount, 4)
        XCTAssertEqual(summary.quietPercent, 50)
        XCTAssertEqual(summary.loudPercent, 50)
    }

    func testAccumulatorAverageDB() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -60.0)
        acc.ingest(levelDB: -40.0)

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.avgDb, -50.0, accuracy: 1e-6)
    }

    func testAccumulatorPeakTracking() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -70.0)
        acc.ingest(levelDB: -20.0)
        acc.ingest(levelDB: -50.0)

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.peakDb, -20.0, accuracy: 1e-6)
    }

    func testAccumulatorSingleSample() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        acc.ingest(levelDB: -35.0) // above -40 threshold → loud

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.sampleCount, 1)
        XCTAssertEqual(summary.avgDb, -35.0, accuracy: 1e-6)
        XCTAssertEqual(summary.peakDb, -35.0, accuracy: 1e-6)
        XCTAssertEqual(summary.quietPercent, 0)
        XCTAssertEqual(summary.loudPercent, 100)
    }

    // MARK: - End-to-end: rms → dBFS → accumulate → summarize

    func testEndToEndSilentSession() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        let silentBuffer: [Float] = Array(repeating: 0, count: 1024)
        let rms = AmbientSoundLevelLogic.rms(from: silentBuffer)
        let db = AmbientSoundLevelLogic.toDBFS(rms: rms)
        acc.ingest(levelDB: db)

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.avgDb, AmbientSoundLevelLogic.silenceFloorDB, accuracy: 1e-6)
        XCTAssertEqual(summary.quietPercent, 100)
    }

    func testEndToEndFullScaleSession() {
        var acc = AmbientSoundLevelLogic.Accumulator()
        let fullBuffer: [Float] = Array(repeating: 1.0, count: 512)
        let rms = AmbientSoundLevelLogic.rms(from: fullBuffer)
        let db = AmbientSoundLevelLogic.toDBFS(rms: rms)
        acc.ingest(levelDB: db)

        guard let summary = acc.summary() else {
            XCTFail("Expected non-nil summary"); return
        }
        XCTAssertEqual(summary.avgDb, 0.0, accuracy: 1e-6) // 0 dBFS
        XCTAssertEqual(summary.loudPercent, 100) // 0 dBFS >> -40 threshold
    }

    // MARK: - Equatable

    func testAccumulatorEquatable() {
        var acc1 = AmbientSoundLevelLogic.Accumulator()
        var acc2 = AmbientSoundLevelLogic.Accumulator()
        acc1.ingest(levelDB: -50.0)
        acc2.ingest(levelDB: -50.0)
        XCTAssertEqual(acc1, acc2)
    }
}
