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
let bgRed:   CGFloat = 10  / 255   // Background color
let bgGreen: CGFloat = 10  / 255
let bgBlue:  CGFloat = 20  / 255

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
    let t = Process()
    t.executableURL = URL(fileURLWithPath: executable)
    t.arguments = args
    do { try t.run() } catch { fail("\(executable) failed to launch: \(error)") }
    t.waitUntilExit()
    guard t.terminationStatus == 0 else {
        fail("\(executable) exited with status \(t.terminationStatus)")
    }
}

func sips(_ src: String, to dest: String, size: Int) {
    run("/usr/bin/sips", ["-z", "\(size)", "\(size)", src, "--out", dest])
}

let iconSize: CGFloat = 1024
let cwd      = FileManager.default.currentDirectoryPath
let iconsDir = "\(cwd)/src-tauri/icons"
let srcFile  = "\(iconsDir)/logo-source.png"
let outFile  = "\(iconsDir)/icon.png"

guard let logo = NSImage(contentsOfFile: srcFile) else {
    fail("Could not load \(srcFile)")
}

// ─── Drawing context ─────────────────────────────────────────────────────────
let cs = CGColorSpaceCreateDeviceRGB()
let bi = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
guard let ctx = CGContext(data: nil,
                          width: Int(iconSize), height: Int(iconSize),
                          bitsPerComponent: 8, bytesPerRow: 0,
                          space: cs, bitmapInfo: bi.rawValue)
else { fail("Could not create CGContext") }

let fullRect     = CGRect(x: 0, y: 0, width: iconSize, height: iconSize)
let inset        = iconSize * canvasInset
let squircleRect = fullRect.insetBy(dx: inset, dy: inset)
let sqSize       = squircleRect.width
let radius       = sqSize * cornerRadiusRatio
let logoPad      = inset + sqSize * paddingRatio
let squirclePath = CGPath(roundedRect: squircleRect, cornerWidth: radius, cornerHeight: radius, transform: nil)

// ─── 1. Clip to squircle + fill background ───────────────────────────────────
ctx.addPath(squirclePath)
ctx.clip()
ctx.setFillColor(NSColor(srgbRed: bgRed, green: bgGreen, blue: bgBlue, alpha: 1).cgColor)
ctx.fill(squircleRect)

// ─── 2. Draw logo centered with padding ──────────────────────────────────────
let logoSize = iconSize - logoPad * 2
let logoRect = CGRect(x: logoPad, y: logoPad, width: logoSize, height: logoSize)
if let cgLogo = logo.cgImage(forProposedRect: nil, context: nil, hints: nil) {
    ctx.draw(cgLogo, in: logoRect)
}

// ─── 3. Specular border highlight ────────────────────────────────────────────
// Clip to the squircle stroke, then paint a diagonal gradient:
// white at top-left + bottom-right corners, transparent at center.
ctx.saveGState()
ctx.resetClip()
ctx.addPath(squirclePath)
ctx.setLineWidth(borderWidth * 2) // doubled so the inner half sits on the icon edge
ctx.replacePathWithStrokedPath()
ctx.clip()

let gradColors: [CGColor] = [
    NSColor(white: 1, alpha: borderOpacity).cgColor,
    NSColor(white: 1, alpha: 0).cgColor,
    NSColor(white: 1, alpha: borderOpacity).cgColor,
]
guard let gradient = CGGradient(colorsSpace: cs, colors: gradColors as CFArray, locations: [0, 0.5, 1] as [CGFloat])
else { fail("Could not create gradient") }

ctx.drawLinearGradient(
    gradient,
    start: CGPoint(x: squircleRect.minX, y: squircleRect.maxY), // top-left  (CG y-up)
    end:   CGPoint(x: squircleRect.maxX, y: squircleRect.minY), // bottom-right
    options: []
)
ctx.restoreGState()

// ─── 4. Save PNG ─────────────────────────────────────────────────────────────
guard let cgImg = ctx.makeImage() else { fail("Could not create CGImage") }
let nsImg = NSImage(cgImage: cgImg, size: NSSize(width: iconSize, height: iconSize))
guard let tiff = nsImg.tiffRepresentation,
      let bmp  = NSBitmapImageRep(data: tiff),
      let png  = bmp.representation(using: .png, properties: [:])
else { fail("Could not encode PNG") }

do {
    try png.write(to: URL(fileURLWithPath: outFile))
    print("✓ icon.png")
} catch {
    fail("Write failed: \(error)")
}

// ─── 5. Generate sizes with sips + iconutil ──────────────────────────────────
// Uses sips/iconutil directly — preserves the transparent canvas inset that
// `bun tauri icon` would otherwise strip when auto-cropping the source image.
let iconset = "/tmp/superagent_gen.iconset"
try? FileManager.default.removeItem(atPath: iconset)
do {
    try FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)
} catch {
    fail("Could not create iconset dir: \(error)")
}

for (name, size): (String, Int) in [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
] { sips(outFile, to: "\(iconset)/\(name)", size: size) }

run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", "\(iconsDir)/icon.icns"])
print("✓ icon.icns")

sips(outFile, to: "\(iconsDir)/32x32.png",      size: 32)
sips(outFile, to: "\(iconsDir)/128x128.png",    size: 128)
sips(outFile, to: "\(iconsDir)/128x128@2x.png", size: 256)
print("✓ PNG sizes")
print("✓ Done")
