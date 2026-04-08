// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-wt-native",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-wt-native",
      type: .static,
      targets: ["tauri-plugin-wt-native"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-wt-native",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
