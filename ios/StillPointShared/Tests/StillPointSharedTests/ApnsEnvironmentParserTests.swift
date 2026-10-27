import Foundation
import Testing
@testable import StillPointShared

struct ApnsEnvironmentParserTests {
    @Test func testParsesDevelopmentEnvironment() {
        #expect(ApnsEnvironmentParser.parse(fromProfileString: profile(environment: "development")) == "development")
    }

    @Test func testParsesProductionEnvironment() {
        #expect(ApnsEnvironmentParser.parse(fromProfileString: profile(environment: "production")) == "production")
    }

    @Test func testRejectsMalformedProfile() {
        #expect(ApnsEnvironmentParser.parse(fromProfileString: "not a provisioning profile") == nil)
    }

    @Test func testRejectsClosingPlistBeforeOpeningPlist() {
        #expect(ApnsEnvironmentParser.parse(fromProfileString: "</plist> before <plist version=\"1.0\">") == nil)
    }

    @Test func testRejectsUnexpectedEnvironment() {
        #expect(ApnsEnvironmentParser.parse(fromProfileString: profile(environment: "staging")) == nil)
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
