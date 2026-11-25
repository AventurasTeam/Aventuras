// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-generation",
  platforms: [
    .iOS(.v15)
  ],
  products: [
    .library(
      name: "tauri-plugin-generation",
      type: .static,
      targets: ["tauri-plugin-generation"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-generation",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
