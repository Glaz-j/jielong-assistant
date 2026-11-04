import Cocoa
import ApplicationServices

// Read-only adapter: never clicks, types, sends messages, or changes QQ settings.
let args = CommandLine.arguments
let group = args.dropFirst().first(where: { !$0.hasPrefix("--") }) ?? "接龙助手测试群"
func emit(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
       let text = String(data: data, encoding: .utf8) { print(text) }
}
let prompt = args.contains("--prompt")
let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary)
guard trusted else { emit(["status":"permission_needed", "group":group]); exit(0) }
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.tencent.qq").first(where: { $0.bundleURL?.path == "/Applications/QQ.app" }) else {
    emit(["status":"qq_not_running", "group":group]); exit(0)
}
let root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(root, 1.5)
func attr(_ e: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(e, key as CFString, &value) != .success { return nil }
    return value
}
func str(_ e: AXUIElement, _ key: String) -> String { return attr(e,key) as? String ?? "" }
func children(_ e: AXUIElement) -> [AXUIElement] { return attr(e,kAXChildrenAttribute) as? [AXUIElement] ?? [] }
var budget = 16000
func find(_ e: AXUIElement, depth: Int = 0, predicate: (AXUIElement)->Bool) -> AXUIElement? {
    budget -= 1
    if budget <= 0 || depth > 28 { return nil }
    if predicate(e) { return e }
    for c in children(e) { if let found=find(c,depth:depth+1,predicate:predicate) { return found } }
    return nil
}
// Match the composer and message list within the SAME window. Never locate
// a composer in one window and then accidentally collect a different chat.
func isTargetComposer(_ e: AXUIElement) -> Bool {
    let role=str(e,kAXRoleAttribute)
    return ["AXTextArea","AXTextField"].contains(role) && str(e,kAXDescriptionAttribute) == group
}
let windows = (attr(root,kAXWindowsAttribute) as? [AXUIElement] ?? [])
    .sorted { str($0,kAXTitleAttribute) != "QQ" && str($1,kAXTitleAttribute) == "QQ" }
var targetWindow: AXUIElement?
var targetMessages: AXUIElement?
for window in windows {
    budget=16000
    guard find(window,predicate:isTargetComposer) != nil else { continue }
    targetWindow=window
    budget=16000
    if let messages=find(window,predicate: { e in
        str(e,kAXDescriptionAttribute) == "消息列表" || str(e,kAXTitleAttribute) == "消息列表"
    }) { targetMessages=messages; break }
}
guard let window=targetWindow else { emit(["status":"target_window_closed", "group":group]); exit(0) }
guard let messages=targetMessages else { emit(["status":"message_list_unavailable","group":group]); exit(0) }
var text: [String] = []
budget=6000
func collect(_ e: AXUIElement, depth: Int = 0) {
    budget -= 1
    if budget <= 0 || depth > 20 { return }
    let role=str(e,kAXRoleAttribute)
    if ["AXStaticText","AXLink"].contains(role) {
        for key in [kAXValueAttribute,kAXTitleAttribute,kAXURLAttribute] {
            if let v=attr(e,key) {
                let t = (v as? String) ?? (v as? URL)?.absoluteString ?? ""
                if !t.isEmpty && t.count < 12000 && text.last != t { text.append(t) }
            }
        }
    }
    for c in children(e) { collect(c,depth:depth+1) }
}
collect(messages)
// A user may switch the main chat while traversal is in progress. Discard that
// sample if the target composer disappeared from this window.
budget=16000
guard find(window,predicate:isTargetComposer) != nil else {
    emit(["status":"target_window_closed","group":group]); exit(0)
}
emit(["status":"ready","group":group,"text":text.joined(separator:"\n")])
