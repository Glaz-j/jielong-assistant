Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
Name "接龙助手"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\JielongAssistant"
InstallDirRegKey HKCU "Software\JielongAssistant" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
CRCCheck force
VIProductVersion "1.1.0.0"
VIAddVersionKey /LANG=2052 "ProductName" "接龙助手"
VIAddVersionKey /LANG=2052 "FileDescription" "接龙助手安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "1.1.0"
VIAddVersionKey /LANG=2052 "LegalCopyright" "JielongAssistant contributors"
!define MUI_WELCOMEPAGE_TITLE "安装接龙助手"
!define MUI_WELCOMEPAGE_TEXT "自动填写所选微信群的新接龙。$\r$\n$\r$\n本安装包已包含运行环境，无需安装开发工具。$\r$\n安装到当前用户目录，创建桌面快捷方式。$\r$\n$\r$\n首次使用需登录本人的微信、接龙管家，并填写四项资料。开机自启默认关闭，可在设置中开启。"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "打开接龙助手，开始设置"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"
!define MUI_FINISHPAGE_TEXT "安装完成。$\r$\n$\r$\n以后双击桌面的“接龙助手”即可打开。首次设置完成后可以关闭页面，后台继续监听。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "将移除程序、快捷方式和开机自启。$\r$\n个人资料、登录状态与报名记录会保留，以便重新安装后继续使用。"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
 SetShellVarContext current
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "此版本需要 64 位 Windows。" /SD IDOK
  SetErrorLevel 2
  Abort
 ${EndIf}
 ${IfNot} ${AtLeastWin10}
  MessageBox MB_OK|MB_ICONSTOP "此版本需要 Windows 10 或更新系统。" /SD IDOK
  SetErrorLevel 2
  Abort
 ${EndIf}
 SetRegView 64
FunctionEnd

Function LaunchApp
 Exec '"$SYSDIR\wscript.exe" //Nologo "$INSTDIR\start.vbs"'
FunctionEnd

Section "接龙助手" SEC_MAIN
 SetShellVarContext current
 SetRegView 64
 ; Stop through our authenticated loopback API and wait for in-flight jobs.
 ; Run from a temporary runtime so an installed node.exe is not locked.
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File /oname=node.exe "${PAYLOAD}/runtime/node.exe"
 File /oname=maintenance.mjs "${PAYLOAD}/delivery/maintenance.mjs"
 nsExec::ExecToStack '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\maintenance.mjs"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "接龙助手尚未退出，未覆盖程序文件。请等待报名结束，退出后台后再安装。$\r$\n$1" /SD IDOK
  SetErrorLevel 2
  Abort
 ${EndIf}
 SetOutPath "$INSTDIR"
 File /r "${PAYLOAD}/*"
 FileOpen $0 "$INSTDIR\installation.json" w
 FileWrite $0 '{"application":"JielongAssistant","version":"1.1.0"}'
 FileClose $0
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\接龙助手"
 CreateShortcut "$DESKTOP\接龙助手.lnk" "$SYSDIR\wscript.exe" '//Nologo "$INSTDIR\start.vbs"'
 CreateShortcut "$SMPROGRAMS\接龙助手\接龙助手.lnk" "$SYSDIR\wscript.exe" '//Nologo "$INSTDIR\start.vbs"'
 CreateShortcut "$SMPROGRAMS\接龙助手\卸载接龙助手.lnk" "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\JielongAssistant" "InstallDir" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant" "DisplayName" "接龙助手"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant" "DisplayVersion" "1.1.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant" "NoRepair" 1
SectionEnd

Section "Uninstall"
 SetShellVarContext current
 SetRegView 64
 InitPluginsDir
 CopyFiles /SILENT "$INSTDIR\runtime\node.exe" "$PLUGINSDIR\node.exe"
 CopyFiles /SILENT "$INSTDIR\delivery\maintenance.mjs" "$PLUGINSDIR\maintenance.mjs"
 nsExec::ExecToStack '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\maintenance.mjs"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "仍有任务运行，请先退出接龙助手后台后重试卸载。" /SD IDOK
  SetErrorLevel 2
  Abort
 ${EndIf}
 ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JielongAssistant"
 ${If} $0 == '"$WINDIR\System32\wscript.exe" //B //Nologo "$INSTDIR\start-background.vbs"'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JielongAssistant"
 ${EndIf}
 Delete "$DESKTOP\接龙助手.lnk"
 Delete "$SMPROGRAMS\接龙助手\接龙助手.lnk"
 Delete "$SMPROGRAMS\接龙助手\卸载接龙助手.lnk"
 RMDir "$SMPROGRAMS\接龙助手"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JielongAssistant"
 DeleteRegKey HKCU "Software\JielongAssistant"
 ; Exact generated file allowlist: never recursively delete an arbitrary install
 ; directory, and never delete LocalAppData/JielongAssistant user data.
 !include "${REMOVE_LIST}"
 Delete "$INSTDIR\installation.json"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
SectionEnd
