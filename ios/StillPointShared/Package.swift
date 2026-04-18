// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StillPointShared",
    platforms: [
        .iOS(.v17),
        .watchOS(.v10),
    ],
    products: [
        .library(name: "StillPointShared", targets: ["StillPointShared"]),
    ],
    targets: [
        .target(name: "StillPointShared"),
        .testTarget(
            name: "StillPointSharedTests",
            dependencies: ["StillPointShared"]
        ),
    ]
)
