import XCTest
@testable import StillPointShared

final class VoiceCountdownResourceResolverTests: XCTestCase {

    func testSubdirectoryHitDoesNotConsultTheBundleRoot() {
        var calls: [(String, String?)] = []
        let url = VoiceCountdownResourceResolver.url(for: 10) { name, _, subdirectory in
            calls.append((name, subdirectory))
            return subdirectory == "VoiceCountdown"
                ? URL(fileURLWithPath: "/VoiceCountdown/10.mp3")
                : nil
        }
        XCTAssertEqual(url?.lastPathComponent, "10.mp3")
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls[0].0, "10")
        XCTAssertEqual(calls[0].1, "VoiceCountdown")
    }

    func testFlattenedLayoutFallsBackToTheBundleRoot() {
        var subdirectories: [String?] = []
        let url = VoiceCountdownResourceResolver.url(for: 10) { _, _, subdirectory in
            subdirectories.append(subdirectory)
            return subdirectory == nil ? URL(fileURLWithPath: "/10.mp3") : nil
        }
        XCTAssertEqual(url?.path, "/10.mp3")
        XCTAssertEqual(subdirectories.count, 2)
        XCTAssertEqual(subdirectories[0], "VoiceCountdown")
        XCTAssertNil(subdirectories[1])
    }

    func testMissingClipReturnsNilAfterBothLayouts() {
        var calls = 0
        let url = VoiceCountdownResourceResolver.url(for: 4) { _, _, _ in
            calls += 1
            return nil
        }
        XCTAssertNil(url)
        XCTAssertEqual(calls, 2)
    }

    func testOutOfRangeSecondsDoNotTouchTheBundle() {
        for seconds in [0, 61, -1] {
            var called = false
            let url = VoiceCountdownResourceResolver.url(for: seconds) { _, _, _ in
                called = true
                return URL(fileURLWithPath: "/should-not-be-used.mp3")
            }
            XCTAssertNil(url, "seconds \(seconds)")
            XCTAssertFalse(called, "seconds \(seconds)")
        }
    }

    func testBoundarySecondsResolve() {
        for seconds in [1, 60] {
            let url = VoiceCountdownResourceResolver.url(for: seconds) { name, ext, subdirectory in
                XCTAssertEqual(name, "\(seconds)")
                XCTAssertEqual(ext, "mp3")
                return subdirectory == "VoiceCountdown"
                    ? URL(fileURLWithPath: "/VoiceCountdown/\(seconds).mp3")
                    : nil
            }
            XCTAssertEqual(url?.lastPathComponent, "\(seconds).mp3")
        }
    }
}
