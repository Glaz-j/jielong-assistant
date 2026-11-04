Option Explicit
Dim fso, base, flag
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
Set flag = fso.CreateTextFile(base & "\silent-data\stop.flag", True)
flag.WriteLine "stop after active submissions finish"
flag.Close
