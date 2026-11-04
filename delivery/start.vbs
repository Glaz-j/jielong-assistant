Option Explicit
On Error Resume Next
Dim fso, sh, base, cmd, req, i, silent, ready, logs, log
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
silent = False
If WScript.Arguments.Count > 0 Then silent = (WScript.Arguments(0) = "--background")
Function IsReady()
 Err.Clear
 Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
 req.setTimeouts 300, 300, 300, 300
 req.Open "GET", "http://127.0.0.1:47834/", False
 req.Send
 IsReady = False
 If Err.Number = 0 Then
  If req.Status = 200 And InStr(req.responseText, "content=" & Chr(34) & "JielongAssistant" & Chr(34)) > 0 Then IsReady = True
 End If
 Err.Clear
End Function
ready = IsReady()
If Not ready Then
 cmd = Chr(34) & base & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & base & "\delivery\app.mjs" & Chr(34)
 sh.Run cmd, 0, False
 For i = 1 To 120
  WScript.Sleep 250
  If IsReady() Then
   ready = True
   Exit For
  End If
 Next
End If
If ready Then
 If Not silent Then sh.Run "http://127.0.0.1:47834/", 1, False
 WScript.Quit 0
End If
logs = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\JielongAssistant"
If Not fso.FolderExists(logs) Then fso.CreateFolder logs
Set log = fso.CreateTextFile(logs & "\startup-error.txt", True)
log.WriteLine "JielongAssistant could not start. Check port 47834 and application files."
log.Close
If Not silent Then MsgBox "JielongAssistant could not start. Please reinstall or check startup-error.txt in %LOCALAPPDATA%\JielongAssistant.", 48, "JielongAssistant"
WScript.Quit 1
