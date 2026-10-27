# iOS Swift packages — local `swift test` / `swift build`

`ios/StillPointShared` runs its unit tests with `swift test`, the same suite as the required `StillPointShared swift test` check. The SwiftData `@Model` types (`User`, `Session`, `Thought`) live in a separate package, `ios/StillPointModels`, which depends on `StillPointShared`. Only the `StillPoint` app target links it; the widget and monitor extensions use `StillPointShared` alone (Issue [#870](https://github.com/auerbachb/still-point/issues/870)). So `StillPointShared` no longer needs the SwiftData macro plugin. The only macros it uses are the Observation macros, and Command Line Tools ship that plugin.

What each toolchain can run:

| Command | Full Xcode | Command Line Tools only |
|---|---|---|
| `swift test` in `ios/StillPointShared` | Yes | No. Every suite imports XCTest, which ships only with Xcode: `no such module 'XCTest'`. |
| `swift build` in `ios/StillPointShared` | Yes | Should work, since nothing in the package needs SwiftData any more. Not verified: the Command Line Tools 27.0 install used for #870 could not load any `Package.swift` (the `Invalid manifest` failure below). |
| `swift build` in `ios/StillPointModels` | Yes | No. The SwiftData macro plugin ships only with Xcode: `plugin for module 'SwiftDataMacros' not found`. |

**XCTest decision:** the suites stay on XCTest for now, so `swift test` still needs full Xcode. Moving them to swift-testing, which Command Line Tools do ship, is tracked in Issue [#1072](https://github.com/auerbachb/still-point/issues/1072).

Check which toolchain is active:

```bash
xcode-select -p   # needs …/Xcode.app/Contents/Developer, not /Library/Developer/CommandLineTools
```

Some Command Line Tools installs fail even before compiling, while loading `Package.swift`. An upgrade can leave an older `PackageDescription` interface behind:

```text
error: 'stillpointshared': Invalid manifest (compiled with: ["/Library/Developer/CommandLineTools/usr/bin/swiftc", …])
Undefined symbols for architecture arm64:
  "PackageDescription.Package.__allocating_init(name: Swift.String, defaultLocalization: …
```

Either way, the fix is to select Xcode:

```bash
# Machine-wide (asks for an admin password)
sudo xcode-select -s /Applications/Xcode.app

# Or for one command, with no sudo (the form an agent can run)
cd ios/StillPointShared
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test
cd ../StillPointModels
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build
```

If Xcode lives somewhere else, such as `Xcode-beta.app`, use that path. Without Xcode installed, neither command can run locally. Install Xcode, or treat the `StillPointShared swift test` CI check as the first real run and say so in the PR. That check runs `swift test` in `ios/StillPointShared` and then `swift build` in `ios/StillPointModels` whenever either package changes. When neither changes, it passes as a no-op.
