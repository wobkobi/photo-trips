; Installer hooks, included near the top of Tauri's NSIS template.
;
; The installer keys its install folder, uninstall entry and start-with-Windows value by product
; name, so a copy installed under the old name ("Photo Trips") would otherwise stay installed beside
; this one. Before installing, run that copy's uninstaller silently: it closes the old app if it is
; running and removes its program files, shortcuts and Run value, but never the library data (that
; lives under the bundle identifier, which both names share, and silent uninstalls skip the
; delete-data checkbox). After installing, carry the old start-with-Windows choice over.

; Overridable so a test build can migrate from a test-named install instead of the real one.
!ifndef OLD_PRODUCTNAME
  !define OLD_PRODUCTNAME "Photo Trips"
!endif

!define PIC_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

; The old Run value, read before the old uninstaller deletes it.
Var OldRunValue

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $OldRunValue HKCU "${PIC_RUN_KEY}" "${OLD_PRODUCTNAME}"

  ; InstallLocation is stored wrapped in quotes; strip them to get a usable folder path.
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLD_PRODUCTNAME}" "InstallLocation"
  StrCpy $R1 $R0 1
  ${If} $R1 == '"'
    StrCpy $R0 $R0 "" 1
  ${EndIf}
  StrCpy $R1 $R0 "" -1
  ${If} $R1 == '"'
    StrCpy $R0 $R0 -1
  ${EndIf}

  ${If} $R0 != ""
  ${AndIf} $R0 != $INSTDIR
  ${AndIf} ${FileExists} "$R0\uninstall.exe"
    DetailPrint "Removing the old ${OLD_PRODUCTNAME} install from $R0"
    ; _?= runs the uninstaller in place and waits for it; without it NSIS copies itself to a
    ; temp folder and returns at once. Running in place means it can't delete itself, so the
    ; uninstaller and the then-empty folder are removed here, but only after a clean exit (0): a
    ; failed uninstall keeps its uninstaller so the old copy can still be removed by hand.
    ExecWait '"$R0\uninstall.exe" /S _?=$R0' $R2
    ${If} $R2 == 0
      Delete "$R0\uninstall.exe"
      RMDir "$R0"
    ${Else}
      DetailPrint "The old ${OLD_PRODUCTNAME} uninstaller exited with $R2; leaving it in place"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $OldRunValue != ""
    ReadRegStr $R0 HKCU "${PIC_RUN_KEY}" "${PRODUCTNAME}"
    ${If} $R0 == ""
      WriteRegStr HKCU "${PIC_RUN_KEY}" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --hidden'
    ${EndIf}
  ${EndIf}
!macroend
