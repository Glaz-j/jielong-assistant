Option Explicit
Dim shell, fso, base
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & "E:\anaconda3\pythonw.exe" & Chr(34) & " " & Chr(34) & base & "\deploy-probe.py" & Chr(34), 0, False
