# iOS Swift packages — local `swift test` / `swift build`

`ios/StillPointShared` runs its unit tests with `swift test`, the same suite as the required `StillPointShared swift test` check. The SwiftData `@Model` types (`User`, `Session`, `Thought`) live in a separate package, `ios/StillPointModels`, which depends on `StillPointShared`. Only the `StillPoint` app target links it; the widget and monitor extensions use `StillPointShared` alone (Issue [#870](https://github.com/auerbachb/still-point/issues/870)). So `StillPointShared` no longer needs the SwiftData macro plugin. The only macros it uses are the Observation macros, and Command Line Tools ship that plugin.

What each toolchain can run:

| Command | Full Xcode | Command Line Tools only |
|---|---|---|
| `swift test` in `ios/StillPointShared` | Yes | Should work, since every suite uses Swift Testing (`import Testing`) and Command Line Tools ship `Testing.framework`. Not verified: the one install tried could not load `Package.swift` (see **Command Line Tools check** below). |
| `swift build` in `ios/StillPointShared` | Yes | Should work, since nothing in the package needs SwiftData any more. Not verified: the Command Line Tools 27.0 install used for #870 could not load any `Package.swift` (the `Invalid manifest` failure below). |
| `swift build` in `ios/StillPointModels` | Yes | No. The SwiftData macro plugin ships only with Xcode: `plugin for module 'SwiftDataMacros' not found`. |

**Test framework:** every suite in `StillPointSharedTests` uses Swift Testing (`import Testing`), and none imports XCTest (Issue [#1072](https://github.com/auerbachb/still-point/issues/1072)). XCTest ships only with Xcode, so that import was what tied `swift test` to full Xcode. Under full Xcode, `swift test` runs 1047 Swift Testing tests in 116 suites and 0 XCTest tests.

**Command Line Tools check (Issue [#1085](https://github.com/auerbachb/still-point/issues/1085), 2026-10-27):** CLT `27.0.0.0.1788430756` (`pkgutil --pkg-info=com.apple.pkg.CLTools_Executables`), Apple Swift 6.4 (`swiftlang-6.4.0.34.1`). `DEVELOPER_DIR=/Library/Developer/CommandLineTools swift test` failed while loading `Package.swift`, with the `Invalid manifest` / `Undefined symbols` error below, before any test compiled. So the result says nothing about the tests yet. A clean reinstall (`sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install`) or another machine is needed for a real CLT run. Until one passes, use full Xcode.

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
