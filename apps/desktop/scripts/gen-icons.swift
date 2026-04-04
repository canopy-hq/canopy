#!/usr/bin/swift
/// gen-icons.swift — Run from apps/desktop/
/// Generates a macOS-style icon from logo-source.png:
///   • squircle clip mask (~22.4% corner radius, matches macOS)
///   • solid background color
///   • specular border highlight (fades from top corners to bottom)
///   • runs `bun tauri icon` to emit all sizes + ICNS/ICO
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
let borderOpacity:     CGFloat = 0.28   // max highlight opacity (top corners)
// ────────────────────────────────────────────────────────────────────────────

let iconSize: CGFloat = 1024

let cwd       = FileManager.default.currentDirectoryPath
let iconsDir  = "\(cwd)/src-tauri/icons"
let srcFile   = "\(iconsDir)/logo-source.png"
let outFile   = "\(iconsDir)/icon.png"

guard let logo = NSImage(contentsOfFile: srcFile) else {
    fputs("✗ Could not load \(srcFile)\n", stderr); exit(1)
}

// ─── Drawing context ─────────────────────────────────────────────────────────
let cs = CGColorSpaceCreateDeviceRGB()
let bi = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
guard let ctx = CGContext(data: nil,
                          width: Int(iconSize), height: Int(iconSize),
                          bitsPerComponent: 8, bytesPerRow: 0,
                          space: cs, bitmapInfo: bi.rawValue)
else { fputs("✗ Could not create CGContext\n", stderr); exit(1) }

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
// Clip to the squircle stroke area, then paint a gradient that fades
// from white (top) to transparent (middle) — creates the corner shimmer.
ctx.saveGState()
ctx.resetClip()
ctx.addPath(squirclePath)
ctx.setLineWidth(borderWidth * 2) // double so the inner half sits on the icon edge
ctx.replacePathWithStrokedPath()
ctx.clip()

// Diagonal gradient: white at top-left + bottom-right corners, transparent at center
let gradColors: [CGColor] = [
    NSColor(white: 1, alpha: borderOpacity).cgColor,
    NSColor(white: 1, alpha: 0).cgColor,
    NSColor(white: 1, alpha: borderOpacity).cgColor,
]
let gradient = CGGradient(colorsSpace: cs, colors: gradColors as CFArray, locations: [0, 0.5, 1] as [CGFloat])!

ctx.drawLinearGradient(
    gradient,
    start: CGPoint(x: squircleRect.minX, y: squircleRect.maxY), // top-left
    end:   CGPoint(x: squircleRect.maxX, y: squircleRect.minY), // bottom-right
    options: []
)
ctx.restoreGState()

// ─── 4. Save PNG ─────────────────────────────────────────────────────────────
guard let cgImg   = ctx.makeImage(),
      let tiff    = NSImage(cgImage: cgImg, size: .zero).tiffRepresentation,
      let bmp     = NSBitmapImageRep(data: tiff),
      let png     = bmp.representation(using: .png, properties: [:])
else { fputs("✗ Could not encode PNG\n", stderr); exit(1) }

do {
    try png.write(to: URL(fileURLWithPath: outFile))
    print("✓ \(outFile)")
} catch {
    fputs("✗ Write failed: \(error)\n", stderr); exit(1)
}

// ─── 5. Generate sizes with sips + iconutil (preserves transparent canvas inset) ──
func sips(_ src: String, to dest: String, size: Int) {
    let t = Process()
    t.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    t.arguments = ["-z", "\(size)", "\(size)", src, "--out", dest]
    try! t.run(); t.waitUntilExit()
}

// Iconset for ICNS
let iconset = "/tmp/superagent_gen.iconset"
try? FileManager.default.removeItem(atPath: iconset)
try! FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)

for (name, size) in [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
] { sips(outFile, to: "\(iconset)/\(name)", size: size) }

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset, "-o", "\(iconsDir)/icon.icns"]
try! iconutil.run(); iconutil.waitUntilExit()
print("✓ icon.icns")

// Tauri bundle PNGs
sips(outFile, to: "\(iconsDir)/32x32.png",      size: 32)
sips(outFile, to: "\(iconsDir)/128x128.png",    size: 128)
sips(outFile, to: "\(iconsDir)/128x128@2x.png", size: 256)
print("✓ PNG sizes")
print("✓ Done")
