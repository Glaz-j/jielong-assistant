#!/bin/zsh
set -e
cd "${0:A:h}"
dest="QQ群读取器.app/Contents"
mkdir -p "$dest/MacOS"
cat > "$dest/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.jielong.qqreader</string><key>CFBundleName</key><string>QQ群读取器</string><key>CFBundleExecutable</key><string>QQGroupReader</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/></dict></plist>
PLIST
swiftc QQGroupReader.swift -o "$dest/MacOS/QQGroupReader" -framework Cocoa -framework ApplicationServices
codesign --force --sign - "QQ群读取器.app"
