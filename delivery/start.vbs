Option Explicit
On Error Resume Next
Dim fso, sh, base, cmd, req, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = Chr(34) & base & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & base & "\delivery\app.mjs" & Chr(34)
sh.Run cmd, 0, False
For i = 1 To 80
 WScript.Sleep 250
 Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
 req.setTimeouts 300, 300, 300, 300
 req.Open "GET", "http://127.0.0.1:47834/", False
 req.Send
 If Err.Number = 0 Then
  If req.Status = 200 And InStr(req.responseText, "JielongAssistant") > 0 Then
   sh.Run "http://127.0.0.1:47834/", 1, False
   WScript.Quit 0
  End If
 End If
 Err.Clear
Next
Dim log
Set log = fso.CreateTextFile(base & "\startup-error.txt", True)
log.WriteLine "The local application did not become ready. Check port 47834 and Windows permissions."
log.Close
