; ---------------------------------------------------------------------------
; PawnIO, installed as part of HARE's own installation.
;
; Motherboard and RAM lighting is reached over the SMBus, which needs a signed
; kernel driver; OpenRGB moved to PawnIO for this. Asking someone to install a
; driver themselves, from a site they have never heard of, after they have
; already run an installer, is not a working product — so HARE ships it (see
; scripts/pawnio-manifest.mjs, which pins its digest at build time) and
; installs it here, where the installer is already elevated and no second
; prompt is needed.
;
; THE SILENT SWITCH IS VERIFIED, NOT TRUSTED
;
; The installer is packed, so which framework built it cannot be read from the
; file, and a wrong silent switch fails in the worst way: it looks like it
; worked. So each candidate is tried and then *checked* — the driver either
; registered its service or it did not. If nothing silent works, it runs
; visibly rather than quietly doing nothing: a window the user can click
; through is better than a lie.

Var PawnIOPresent

; Sets $PawnIOPresent to "yes" or "no". ExecToLog is used rather than
; ExecToStack because ExecToStack pushes the command's output as well as its
; exit code, and a missed Pop corrupts the stack for everything after it.
Function CheckPawnIO
  nsExec::ExecToLog 'sc.exe query PawnIO'
  Pop $0
  StrCmp $0 "0" pawnio_yes pawnio_no
pawnio_yes:
  StrCpy $PawnIOPresent "yes"
  Goto pawnio_checked
pawnio_no:
  StrCpy $PawnIOPresent "no"
pawnio_checked:
FunctionEnd

!macro customInstall
  DetailPrint "Checking for the PawnIO driver..."
  Call CheckPawnIO
  ; Already there — a previous HARE, or the user installed it themselves.
  ; Nothing to do, and deliberately nothing recorded: HARE must not later
  ; remove a driver it did not put there.
  StrCmp $PawnIOPresent "yes" pawnio_done 0

  StrCpy $1 "$INSTDIR\resources\pawnio\PawnIO-Setup.exe"
  IfFileExists "$1" 0 pawnio_missing

  DetailPrint "Installing the PawnIO driver (motherboard and RAM lighting)..."

  ; WiX/MSI, then NSIS, then Inno. Each is checked before trying the next.
  nsExec::ExecToLog '"$1" /quiet /norestart'
  Pop $0
  Call CheckPawnIO
  StrCmp $PawnIOPresent "yes" pawnio_installed 0

  nsExec::ExecToLog '"$1" /S'
  Pop $0
  Call CheckPawnIO
  StrCmp $PawnIOPresent "yes" pawnio_installed 0

  nsExec::ExecToLog '"$1" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART'
  Pop $0
  Call CheckPawnIO
  StrCmp $PawnIOPresent "yes" pawnio_installed 0

  DetailPrint "Finishing the PawnIO install in its own window..."
  nsExec::ExecToLog '"$1"'
  Pop $0
  Call CheckPawnIO
  StrCmp $PawnIOPresent "yes" pawnio_installed pawnio_failed

pawnio_installed:
  ; Recorded so the uninstaller only removes a driver HARE actually put there.
  ; One the user already had may be in use by FanControl or a hardware
  ; monitor, and taking it away would break them.
  WriteRegDWORD HKLM "Software\HARE" "PawnIOInstalledByHare" 1
  DetailPrint "PawnIO installed."
  Goto pawnio_done

pawnio_missing:
  DetailPrint "No PawnIO installer shipped with this build - skipping."
  Goto pawnio_done

pawnio_failed:
  ; Never fatal. Everything plugged in over USB works without it, and HARE
  ; offers it again from Settings - Hardware.
  DetailPrint "PawnIO was not installed. HARE can install it later from Settings."

pawnio_done:
!macroend

; Custom NSIS steps for the HARE installer.
;
; HARE installs per-user and unelevated, so there is no UAC prompt when
; installing and none when launching. The only thing that ever needs
; administrator rights is the optional scheduled task that starts OpenRGB
; with SMBus access, and the user opts into that from inside the app
; (see electron/backend/elevationHelper.ts) — not here.
;
; What this file is really for is the other half of that promise: making sure
; an uninstall leaves absolutely nothing behind. Anything HARE creates
; outside its own install directory has to be removed here explicitly,
; because NSIS only removes what it installed.

!macro customUnInstall
  ; --- 1. The elevated scheduled task -------------------------------------
  ; Removing it needs the same rights that created it. The uninstaller is not
  ; elevated, so this is raised through PowerShell exactly the way the app
  ; does it. If the user declines the prompt, or the task was never created,
  ; this is a harmless no-op — hence no error handling: there is nothing
  ; useful to tell the user at uninstall time, and failing the uninstall over
  ; it would be worse than leaving one inert task entry.
  ;
  ; Keep this task name in step with OPENRGB_TASK_NAME in elevationHelper.ts.
  ; Uses the scheduled-task cmdlet rather than schtasks for the same reason the
  ; app does (see electron/backend/elevationHelper.ts): nothing has to be
  ; quoted inside anything else, which is what broke the original version.
  ;
  ; NOTE THE $$ IN "-Confirm:$$false". NSIS reads `$name` as one of its own
  ; variables, so a bare `$false` is an unknown-variable warning — and
  ; electron-builder compiles NSIS with warnings as errors, so it fails the
  ; whole installer build rather than the line. `$$` is NSIS's escape for a
  ; literal dollar; PowerShell receives `-Confirm:$false` as intended.
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath ''powershell.exe'' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @(''-NoProfile'',''-Command'',''Unregister-ScheduledTask -TaskName ''''HARE OpenRGB Access'''' -Confirm:$$false'')"'
  Pop $0

  ; --- 1b. The PawnIO driver, but only if HARE installed it ---------------
  ; The marker is written during install and only when HARE was the one that
  ; put the driver there. A PawnIO the user already had may well be driving
  ; FanControl or a hardware monitor right now, and removing it would break
  ; them — "leave nothing behind" means nothing of *ours*, not nothing at all.
  ;
  ; Every dollar below is doubled: NSIS reads `$name` as one of its own
  ; variables, so a bare PowerShell `$_` would be an unknown-variable warning,
  ; and electron-builder compiles NSIS with warnings as errors.
  ReadRegDWORD $0 HKLM "Software\HARE" "PawnIOInstalledByHare"
  StrCmp $0 "1" 0 skip_pawnio
    DetailPrint "Removing the PawnIO driver HARE installed..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -Command "$$keys = @(''HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'',''HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*''); $$app = Get-ItemProperty $$keys -ErrorAction SilentlyContinue | Where-Object { $$_.DisplayName -like ''PawnIO*'' } | Select-Object -First 1; if ($$app -and $$app.UninstallString) { Start-Process -FilePath ''cmd.exe'' -ArgumentList ''/c'',$$app.UninstallString,''/quiet'',''/norestart'' -Wait }"'
    Pop $0
  skip_pawnio:
  DeleteRegValue HKLM "Software\HARE" "PawnIOInstalledByHare"
  DeleteRegKey /ifempty HKLM "Software\HARE"

  ; --- 2. Stop any OpenRGB that HARE started ------------------------------
  ; Only the bundled copy under HARE's own data directory, so a separately
  ; installed OpenRGB the user runs themselves is left strictly alone.
  nsExec::ExecToLog 'taskkill /F /IM OpenRGB.exe /FI "IMAGENAME eq OpenRGB.exe"'
  Pop $0

  ; --- 3. User data -------------------------------------------------------
  ; Electron's userData directory. This is settings, gallery, saved per-device
  ; lighting, AND every installed add-on module (they're deliberately kept
  ; under here so that removing HARE removes them with no special-casing).
  RMDir /r "$APPDATA\HARE"
  ; Cache, GPU cache, logs and the updatable OpenRGB copy.
  RMDir /r "$LOCALAPPDATA\HARE"

  ; --- 4. Registry --------------------------------------------------------
  ; The launch-at-startup entry, written by app.setLoginItemSettings().
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HARE"
  ; Any app-scoped key, removed only if empty of anything we didn't create.
  DeleteRegKey /ifempty HKCU "Software\HARE"
!macroend
