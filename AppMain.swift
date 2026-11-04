import Cocoa
import WebKit

// Native shell: an explicit app launch opens this window; background automation
// itself never activates the app or opens external browser windows.
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var backend: Process?
    var log: FileHandle?
    let origin = URL(string: "http://127.0.0.1:47831/")!
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu=NSMenu(), item=NSMenuItem(), appMenu=NSMenu()
        appMenu.addItem(withTitle:"退出接龙助手",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        item.submenu=appMenu;menu.addItem(item);NSApp.mainMenu=menu
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1080,height:780),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.title="接龙助手 · QQ 版";window.center();window.isReleasedWhenClosed=false
        web=WKWebView(frame:window.contentView!.bounds);web.autoresizingMask=[.width,.height];web.navigationDelegate=self;window.contentView=web
        window.makeKeyAndOrderFront(nil)
        connect(attempt:0)
    }
    func connect(attempt:Int) {
        URLSession.shared.dataTask(with:origin.appendingPathComponent("api/health")){data,_,_ in
            DispatchQueue.main.async {
                if let data=data,let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],object["app"] as? String == "jielong-assistant" {
                    self.web.load(URLRequest(url:self.origin));return
                }
                if attempt==0 {do {try self.startBackend()}catch{self.showError("本地服务启动失败，请检查应用目录和 Node.js 环境。\(error.localizedDescription)");return}}
                guard attempt<30 else {self.showError("本地服务未能启动。请检查本机 47831 端口或应用日志。");return}
                DispatchQueue.main.asyncAfter(deadline:.now()+0.5){self.connect(attempt:attempt+1)}
            }
        }.resume()
    }
    func startBackend() throws {
        let resources=Bundle.main.resourceURL!
        let config=(try JSONSerialization.jsonObject(with:Data(contentsOf:resources.appendingPathComponent("config.json")))) as! [String:String]
        let process=Process();process.executableURL=URL(fileURLWithPath:config["node"]!);process.arguments=[resources.appendingPathComponent("app/server.mjs").path];process.currentDirectoryURL=resources.appendingPathComponent("app")
        var environment=ProcessInfo.processInfo.environment
        environment["JIELONG_DATA_DIR"]=config["data"];environment["JIELONG_READER"]=config["reader"];environment["PATH"]="/opt/homebrew/bin:/opt/homebrew/opt/node@26/bin:/usr/bin:/bin"
        process.environment=environment
        let logURL=URL(fileURLWithPath:config["data"]!).appendingPathComponent("app.log")
        if !FileManager.default.fileExists(atPath:logURL.path){FileManager.default.createFile(atPath:logURL.path,contents:nil,attributes:[.posixPermissions:0o600])}
        log=try FileHandle(forWritingTo:logURL);try log?.seekToEnd();process.standardOutput=log;process.standardError=log
        try process.run();backend=process
    }
    func showError(_ message:String){web.loadHTMLString("<html><meta charset='utf-8'><body style='font:18px -apple-system;padding:48px'><h2>接龙助手暂时无法连接</h2><p>\(message.replacingOccurrences(of:"<",with:"&lt;"))</p></body></html>",baseURL:nil)}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{if !flag{window.makeKeyAndOrderFront(nil)};return true}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return false}
    func applicationWillTerminate(_ notification:Notification){if backend?.isRunning==true{backend?.terminate()};try? log?.close()}
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let u=navigationAction.request.url else{decisionHandler(.cancel);return}
        decisionHandler(u.scheme=="http"&&u.host=="127.0.0.1"&&u.port==47831 ? .allow:.cancel)
    }
}
let app=NSApplication.shared
let delegate=AppDelegate();app.delegate=delegate
app.setActivationPolicy(.regular);app.run()
