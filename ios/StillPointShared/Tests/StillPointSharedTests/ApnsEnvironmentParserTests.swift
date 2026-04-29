import XCTest
@testable import StillPointShared

final class ApnsEnvironmentParserTests: XCTestCase {
    func testParsesDevelopmentEnvironment() {
        XCTAssertEqual(
            ApnsEnvironmentParser.parse(fromProfileString: profile(environment: "development")),
            "development"
        )
    }

    func testParsesProductionEnvironment() {
        XCTAssertEqual(
            ApnsEnvironmentParser.parse(fromProfileString: profile(environment: "production")),
            "production"
        )
    }

    func testRejectsMalformedProfile() {
        XCTAssertNil(ApnsEnvironmentParser.parse(fromProfileString: "not a provisioning profile"))
    }

    func testRejectsClosingPlistBeforeOpeningPlist() {
        XCTAssertNil(ApnsEnvironmentParser.parse(fromProfileString: "</plist> before <plist version=\"1.0\">"))
    }

    func testRejectsUnexpectedEnvironment() {
        XCTAssertNil(ApnsEnvironmentParser.parse(fromProfileString: profile(environment: "staging")))
    }

    private func profile(environment: String) -> String {
        """
        noise before plist
        <plist version="1.0">
        <dict>
          <key>Entitlements</key>
          <dict>
            <key>aps-environment</key>
            <string>\(environment)</string>
          </dict>
        </dict>
        </plist>
        noise after plist
        """
    }
}
