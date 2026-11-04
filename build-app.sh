#!/bin/zsh
set -e
cd "${0:A:h}"
app_dest="dist/接龙助手.app/Contents"
mkdir -p "$app_dest/MacOS" "$app_dest/Resources/app"
cat > "$app_dest/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.jielong.assistant</string><key>CFBundleName</key><string>接龙助手</string><key>CFBundleExecutable</key><string>JielongAssistant</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.2.0</string><key>CFBundleVersion</key><string>2</string><key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>
PLIST
cp ./*.mjs package.json "$app_dest/Resources/app/"
rsync -a --delete public/ "$app_dest/Resources/app/public/"
rsync -a --delete node_modules/ "$app_dest/Resources/app/node_modules/"
node --input-type=module - "$app_dest/Resources/config.json" <<'JS'
import fs from 'node:fs';import path from 'node:path';
const root=process.cwd();fs.writeFileSync(process.argv[2],JSON.stringify({node:process.execPath,data:path.join(root,'data'),reader:path.join(root,'QQ群读取器.app/Contents/MacOS/QQGroupReader')},null,2));
JS
swiftc AppMain.swift -o "$app_dest/MacOS/JielongAssistant" -framework Cocoa -framework WebKit
codesign --force --sign - "dist/接龙助手.app"
