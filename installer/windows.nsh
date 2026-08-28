!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0

  ${If} $R0 == 0
    DetailPrint "Encerrando o AltGrid antes da manutenção..."

    ; Newer versions understand this command and can persist state before exit.
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      nsExec::Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --shutdown-for-maintenance'
      Pop $R1
      Sleep 2500
    ${EndIf}

    ; Older releases do not understand the maintenance command. Ask every
    ; matching process to close and then terminate the remaining process tree.
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R1
      Sleep 1500
    ${EndIf}

    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $R1
      Sleep 1500
    ${EndIf}

    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "O AltGrid está aberto com uma permissão superior. Feche-o pelo Gerenciador de Tarefas ou execute este instalador como administrador."
      ${nsProcess::Unload}
      Quit
    ${EndIf}
  ${EndIf}

  ${nsProcess::Unload}
!macroend
