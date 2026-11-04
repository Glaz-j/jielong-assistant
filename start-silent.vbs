Option Explicit
On Error Resume Next
Dim fso, sh, base, node, flag, command, errFile
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then
  Set errFile = fso.CreateTextFile(base & "\startup-error.txt", True)
  errFile.WriteLine "Node.js was not found. Install Node.js before starting."
  errFile.Close
  WScript.Quit 1
End If
flag = base & "\silent-data\stop.flag"
If fso.FileExists(flag) Then fso.DeleteFile flag, True
command = Chr(34) & node & Chr(34) & " " & Chr(34) & base & "\silent-worker.mjs" & Chr(34) & " " & Chr(34) & base & "\silent-data" & Chr(34)
sh.Run command, 0, False
If Err.Number <> 0 Then
  Set errFile = fso.CreateTextFile(base & "\startup-error.txt", True)
  errFile.WriteLine Err.Description
  errFile.Close
End If
