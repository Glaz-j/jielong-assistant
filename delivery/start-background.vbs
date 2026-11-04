Option Explicit
Dim sh, fso, base
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run Chr(34) & sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe" & Chr(34) & " //B //Nologo " & Chr(34) & base & "\start.vbs" & Chr(34) & " --background", 0, False
