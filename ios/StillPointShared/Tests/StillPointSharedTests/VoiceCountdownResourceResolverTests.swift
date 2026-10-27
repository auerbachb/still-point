import Foundation
import Testing
@testable import StillPointShared

struct VoiceCountdownResourceResolverTests {

    @Test func testSubdirectoryHitDoesNotConsultTheBundleRoot() {
        var calls: [(String, String?)] = []
        let url = VoiceCountdownResourceResolver.url(for: 10) { name, _, subdirectory in
            calls.append((name, subdirectory))
            return subdirectory == "VoiceCountdown"
                ? URL(fileURLWithPath: "/VoiceCountdown/10.mp3")
                : nil
        }
        #expect(url?.lastPathComponent == "10.mp3")
        #expect(calls.count == 1)
        #expect(calls[0].0 == "10")
        #expect(calls[0].1 == "VoiceCountdown")
    }

    @Test func testFlattenedLayoutFallsBackToTheBundleRoot() {
        var subdirectories: [String?] = []
        let url = VoiceCountdownResourceResolver.url(for: 10) { _, _, subdirectory in
            subdirectories.append(subdirectory)
            return subdirectory == nil ? URL(fileURLWithPath: "/10.mp3") : nil
        }
        #expect(url?.path == "/10.mp3")
        #expect(subdirectories.count == 2)
        #expect(subdirectories[0] == "VoiceCountdown")
        #expect(subdirectories[1] == nil)
    }

    @Test func testMissingClipReturnsNilAfterBothLayouts() {
        var calls = 0
        let url = VoiceCountdownResourceResolver.url(for: 4) { _, _, _ in
            calls += 1
            return nil
        }
        #expect(url == nil)
        #expect(calls == 2)
    }

    @Test func testOutOfRangeSecondsDoNotTouchTheBundle() {
        for seconds in [0, 61, -1] {
            var called = false
            let url = VoiceCountdownResourceResolver.url(for: seconds) { _, _, _ in
                called = true
                return URL(fileURLWithPath: "/should-not-be-used.mp3")
            }
            #expect(url == nil, "seconds \(seconds)")
            #expect(!called, "seconds \(seconds)")
        }
    }

    @Test func testBoundarySecondsResolve() {
        for seconds in [1, 60] {
            let url = VoiceCountdownResourceResolver.url(for: seconds) { name, ext, subdirectory in
                #expect(name == "\(seconds)")
                #expect(ext == "mp3")
                return subdirectory == "VoiceCountdown"
                    ? URL(fileURLWithPath: "/VoiceCountdown/\(seconds).mp3")
                    : nil
            }
            #expect(url?.lastPathComponent == "\(seconds).mp3")
        }
    }
}
