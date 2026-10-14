; qterm's additions to Tauri's NSIS installer.

; Uninstalling removes "Open in qterm" from Explorer's menu, if it starts this copy
; (a portable qterm may own it instead; see src-tauri/src/explorer.rs).
!macro NSIS_HOOK_POSTUNINSTALL
  ReadRegStr $0 HKCU "Software\Classes\Directory\shell\qterm\command" ""
  StrLen $1 '"$INSTDIR\'
  StrCpy $2 $0 $1
  ${If} $2 == '"$INSTDIR\'
    DeleteRegKey HKCU "Software\Classes\Directory\shell\qterm"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\qterm"
    DeleteRegKey HKCU "Software\Classes\Drive\shell\qterm"
  ${EndIf}
!macroend
