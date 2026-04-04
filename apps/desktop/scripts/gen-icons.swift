#!/usr/bin/swift
/// gen-icons.swift — Run from apps/desktop/
/// Generates a macOS-style icon from logo-source.png:
///   • squircle clip mask (~22.4% corner radius, matches macOS)
///   • solid background color
///   • diagonal specular border highlight (top-left ↔ bottom-right)
///   • outputs icon.png + ICNS + Tauri bundle PNGs via sips + iconutil
///
/// After regenerating, clear the macOS icon cache to see changes:
///   sudo rm -rf /Library/Caches/com.apple.iconservices.store && killall Dock
import AppKit
import Foundation

// ─── Config ─────────────────────────────────────────────────────────────────
let bgColor        = NSColor(srgbRed: 10/255, green: 10/255, blue: 20/255, alpha: 1)
let canvasInset:       CGFloat = 0.08   // transparent margin around squircle (% of canvas)
let cornerRadiusRatio: CGFloat = 0.224  // ~22.4% — matches macOS squircle
let paddingRatio:      CGFloat = 0.095  // logo padding each side (% of squircle)
let borderWidth:       CGFloat = 7.0    // specular stroke width (at 1024px)
let borderOpacity:     CGFloat = 0.28   // max highlight opacity (corners)
// ────────────────────────────────────────────────────────────────────────────

func fail(_ msg: String) -> Never {
    fputs("✗ \(msg)\n", stderr); exit(1)
}

func run(_ executable: String, _ args: [String]) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = args
    do { try process.run() } catch { fail("\(executable) failed to launch: \(error)") }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        fail("\(executable) exited with status \(process.terminationStatus)")
    }
}

func sips(_ src: String, to dest: String, size: Int) {
    run("/usr/bin/sips", ["-z", "\(size)", "\(size)", src, "--out", dest])
}

let iconSize: CGFloat = 1024
let cwd      = FileManager.default.currentDirectoryPath
let iconsDir = "\(cwd)/src-tauri/icons"
let outFile  = "\(iconsDir)/icon.png"

guard let logo = NSImage(contentsOfFile: "\(iconsDir)/logo-source.png") else {
    fail("Could not load logo-source.png — run from apps/desktop/")
}

let cs         = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
guard let ctx  = CGContext(data: nil,
                           width: Int(iconSize), height: Int(iconSize),
                           bitsPerComponent: 8, bytesPerRow: 0,
                           space: cs, bitmapInfo: bitmapInfo.rawValue)
else { fail("Could not create CGContext") }

let inset        = iconSize * canvasInset
let squircleRect = CGRect(x: 0, y: 0, width: iconSize, height: iconSize).insetBy(dx: inset, dy: inset)
let radius       = squircleRect.width * cornerRadiusRatio
let logoPad      = inset + squircleRect.width * paddingRatio
let squirclePath = CGPath(roundedRect: squircleRect, cornerWidth: radius, cornerHeight: radius, transform: nil)

ctx.addPath(squirclePath)
ctx.clip()
ctx.setFillColor(bgColor.cgColor)
ctx.fill(squircleRect)

let logoSize = iconSize - logoPad * 2
if let cgLogo = logo.cgImage(forProposedRect: nil, context: nil, hints: nil) {
    ctx.draw(cgLogo, in: CGRect(x: logoPad, y: logoPad, width: logoSize, height: logoSize))
}

// Specular border: clip to stroke area, diagonal gradient white at top-left + bottom-right
ctx.saveGState()
ctx.resetClip()
ctx.addPath(squirclePath)
ctx.setLineWidth(borderWidth * 2) // doubled so inner half sits on the icon edge
ctx.replacePathWithStrokedPath()
ctx.clip()
let gradColors: [CGColor] = [
    NSColor(white: 1, alpha: borderOpacity).cgColor,
    NSColor(white: 1, alpha: 0).cgColor,
    NSColor(white: 1, alpha: borderOpacity).cgColor,
]
guard let gradient = CGGradient(colorsSpace: cs, colors: gradColors as CFArray, locations: [0, 0.5, 1] as [CGFloat])
else { fail("Could not create gradient") }
ctx.drawLinearGradient(gradient,
    start: CGPoint(x: squircleRect.minX, y: squircleRect.maxY),
    end:   CGPoint(x: squircleRect.maxX, y: squircleRect.minY),
    options: [])
ctx.restoreGState()

guard let cgImg = ctx.makeImage() else { fail("Could not create CGImage") }
let nsImg = NSImage(cgImage: cgImg, size: NSSize(width: iconSize, height: iconSize))
guard let tiff = nsImg.tiffRepresentation,
      let bmp  = NSBitmapImageRep(data: tiff),
      let png  = bmp.representation(using: .png, properties: [:])
else { fail("Could not encode PNG") }
do { try png.write(to: URL(fileURLWithPath: outFile)) } catch { fail("Write failed: \(error)") }
print("✓ icon.png")

// Generate iconset, build ICNS, then copy bundle PNGs from iconset (avoids re-scaling)
let iconset = "/tmp/superagent_gen.iconset"
try? FileManager.default.removeItem(atPath: iconset) // ensure clean slate
do { try FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true) }
catch { fail("Could not create iconset dir: \(error)") }

let iconsetSizes: [(String, Int)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]
for (name, size) in iconsetSizes { sips(outFile, to: "\(iconset)/\(name)", size: size) }

run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", "\(iconsDir)/icon.icns"])
print("✓ icon.icns")

// Copy Tauri bundle PNGs from the already-generated iconset instead of re-scaling
let fm = FileManager.default
for (src, dest) in [
    ("\(iconset)/icon_32x32.png",      "\(iconsDir)/32x32.png"),
    ("\(iconset)/icon_128x128.png",    "\(iconsDir)/128x128.png"),
    ("\(iconset)/icon_128x128@2x.png", "\(iconsDir)/128x128@2x.png"),
] {
    try? fm.removeItem(atPath: dest)
    do { try fm.copyItem(atPath: src, toPath: dest) }
    catch { fail("Could not copy \(src): \(error)") }
}
print("✓ PNG sizes")
print("✓ Done")
