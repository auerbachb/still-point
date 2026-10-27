// swift-tools-version: 5.9
import PackageDescription

// SwiftData `@Model` types for the StillPoint app. Kept out of
// StillPointShared so that package builds without the SwiftData macro
// plugin, which Command Line Tools do not ship (Issue #870).
let package = Package(
    name: "StillPointModels",
    platforms: [
        .iOS(.v17),
        .watchOS(.v10),
        .macOS(.v14),
    ],
    products: [
        .library(name: "StillPointModels", targets: ["StillPointModels"]),
    ],
    dependencies: [
        .package(path: "../StillPointShared"),
    ],
    targets: [
        .target(
            name: "StillPointModels",
            dependencies: [
                .product(name: "StillPointShared", package: "StillPointShared"),
            ]
        ),
    ]
)
