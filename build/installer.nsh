; ---------------------------------------------------------------------------
; How the installer looks, and what it says.
;
; The default NSIS wizard is a grey box that says "Welcome to the HARE Setup
; Wizard" and then asks a series of questions with no context. HARE installs a
; kernel driver, a system runtime and a background service, so the pages are
; worth writing properly: someone should be able to read them and know exactly
; what is about to happen to their PC.
;
; Every !define below is guarded. electron-builder sets some of these itself,
; and re-defining an existing name is NSIS warning 6003 -- which, because
; warnings are errors here, would fail the whole build rather than the line.
!macro customHeader
  ; --- Let people watch, if they want to -----------------------------------
  ;
  ; electron-builder's own common.nsh sets `ShowInstDetails nevershow`, which
  ; removes the log *and* the button that reveals it. That leaves a progress
  ; bar and nothing else while setup installs two other people's software --
  ; and it made every DetailPrint in this file write to somewhere nobody can
  ; look, including the ones that say what the driver and the runtime are
  ; doing.
  ;
  ; `hide` is the middle setting, and the one that was wanted all along: the
  ; log starts collapsed behind a "Show details" button, so the wizard is
  ; still quiet for people who don't care and completely open to people who
  ; do. Set here rather than in electron-builder's template because
  ; customHeader is expanded after common.nsh, so this wins.
  ShowInstDetails hide
  !ifdef BUILD_UNINSTALLER
    ShowUninstDetails hide
  !endif

  ; --- The dark header and welcome/finish pages, matching the app ----------
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !define MUI_BGCOLOR "0F0F14"
  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_TEXTCOLOR "F2EEF7"

  ; --- Welcome -------------------------------------------------------------
  !ifdef MUI_WELCOMEPAGE_TITLE
    !undef MUI_WELCOMEPAGE_TITLE
  !endif
  !define MUI_WELCOMEPAGE_TITLE "HARE$\r$\nOne app for every light in your PC"
  !ifdef MUI_WELCOMEPAGE_TEXT
    !undef MUI_WELCOMEPAGE_TEXT
  !endif
  !define MUI_WELCOMEPAGE_TEXT "HARE controls the RGB lighting on your keyboard, mouse, fans, memory, motherboard and cooler, from one place.$\r$\n$\r$\nEverything it needs is inside this installer. Nothing is downloaded, and you don't need to install anything else afterwards.$\r$\n$\r$\nAlong the way it will also set up:$\r$\n    OpenRGB, the engine HARE drives$\r$\n    The Microsoft Visual C++ runtime that engine needs$\r$\n    PawnIO, a signed driver for motherboard and memory lighting$\r$\n$\r$\nBy Ravitz Computers.$\r$\n$\r$\nClick Next to begin."

  ; --- Licence -------------------------------------------------------------
  !ifdef MUI_LICENSEPAGE_TEXT_TOP
    !undef MUI_LICENSEPAGE_TEXT_TOP
  !endif
  !define MUI_LICENSEPAGE_TEXT_TOP "HARE is free and open source, under the MIT licence."
  !ifdef MUI_LICENSEPAGE_TEXT_BOTTOM
    !undef MUI_LICENSEPAGE_TEXT_BOTTOM
  !endif
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "HARE also includes OpenRGB and PawnIO, which are licensed under the GPL. Their full terms are installed alongside HARE, in the licenses folder, and are shown in Settings under About."
  !ifdef MUI_LICENSEPAGE_BUTTON
    !undef MUI_LICENSEPAGE_BUTTON
  !endif
  !define MUI_LICENSEPAGE_BUTTON "Next >"

  ; --- Where it goes -------------------------------------------------------
  !ifdef MUI_DIRECTORYPAGE_TEXT_TOP
    !undef MUI_DIRECTORYPAGE_TEXT_TOP
  !endif
  !define MUI_DIRECTORYPAGE_TEXT_TOP "HARE installs for everyone on this PC, so it only asks for permission once -- here, rather than every time you open it. Your settings and saved looks are kept in your own user folder."

  ; --- Finish --------------------------------------------------------------
  !ifdef MUI_FINISHPAGE_TITLE
    !undef MUI_FINISHPAGE_TITLE
  !endif
  !define MUI_FINISHPAGE_TITLE "HARE is installed"
  !ifdef MUI_FINISHPAGE_TEXT
    !undef MUI_FINISHPAGE_TEXT
  !endif
  !define MUI_FINISHPAGE_TEXT "Open HARE and it will find your lighting on its own.$\r$\n$\r$\nIf a device doesn't appear, Settings has a Hardware page that says what to try next."
  !ifdef MUI_FINISHPAGE_RUN_TEXT
    !undef MUI_FINISHPAGE_RUN_TEXT
  !endif
  !define MUI_FINISHPAGE_RUN_TEXT "Open HARE now"

  ; --- Leaving early -------------------------------------------------------
  !ifdef MUI_ABORTWARNING_TEXT
    !undef MUI_ABORTWARNING_TEXT
  !endif
  !define MUI_ABORTWARNING_TEXT "Stop installing HARE?$\r$\n$\r$\nNothing will be left behind."

  ; The strip along the bottom of every page.
  BrandingText "HARE by Ravitz Computers"
!macroend

; ---------------------------------------------------------------------------
; PawnIO, installed as part of HARE's own installation.
;
; Motherboard and RAM lighting is reached over the SMBus, which needs a signed
; kernel driver; OpenRGB moved to PawnIO for this. Asking someone to install a
; driver themselves, from a site they have never heard of, after they have
; already run an installer, is not a working product -- so HARE ships it (see
; scripts/pawnio-manifest.mjs, which pins its digest at build time) and
; installs it here, where the installer is already elevated and no second
; prompt is needed.
;
; NO SILENT SWITCH IS GUESSED
;
; The installer is packed, so which framework built it can't be read from the
; file. An earlier version tried three likely silent switches in turn and
; waited for each; the installer showed an error dialog for the ones it didn't
; recognise, and waiting on a modal window nobody could see hung the whole
; installation. Guessing was the mistake, not the particular guesses.
;
; It now runs with no arguments, in its own window, and is not waited on.

; Only compiled into the installer.
;
; electron-builder runs makensis TWICE -- once for the installer, once for the
; uninstaller (BUILD_UNINSTALLER). In the uninstaller pass `customInstall` is
; never expanded, so this function would be defined and never called, which is
; NSIS warning 6010 -- and warnings are errors here, so it failed the build
; rather than the function. A Function can't live inside a macro (macros
; expand inside Sections), so the guard is the fix.
!ifndef BUILD_UNINSTALLER

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

!endif

!macro customInstall
  ; --- Make "Show details" show something ----------------------------------
  ;
  ; electron-builder's installSection.nsh opens with `SetDetailsPrint none`,
  ; which silences every DetailPrint for the rest of the section. With the log
  ; button now revealed, that produced the worst of both: a Show details
  ; button that opens an empty box.
  ;
  ; `listonly` writes into the log without touching the status line above the
  ; progress bar, which electron-builder is using for its own text. The file
  ; extraction has already happened by the time this macro runs, so what shows
  ; up is exactly the interesting part -- the two other installers HARE runs.
  SetDetailsPrint listonly
  DetailPrint "Setting up the parts HARE needs..."

  ; --- The Visual C++ runtime OpenRGB needs -------------------------------
  ;
  ; OpenRGB is built against it, and without it OpenRGB.exe simply fails to
  ; start -- no error anyone can act on, no devices in HARE, and every sign
  ; pointing at HARE being broken. That is exactly how this was found, on a
  ; clean PC. So it ships inside HARE and is installed here.
  ;
  ; Skipped when it's already registered, which on most PCs it is.
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  StrCmp $0 "1" redist_done 0
    StrCpy $2 "$INSTDIR\resources\redist\vc_redist.x64.exe"
    IfFileExists "$2" 0 redist_done
      DetailPrint "Installing the Microsoft Visual C++ runtime (OpenRGB needs it)..."
      ; Waited on, unlike the driver: OpenRGB cannot start until this
      ; finishes, and the finish page offers to launch HARE straight after.
      ;
      ; Two behaviours, because there are two genuinely different situations.
      ; A person running the installer sees the runtime install, which is
      ; honest about what is being put on their PC. An unattended install --
      ; `/S`, which is what `winget install` uses -- must not put a window on
      ; screen at all, so it gets Microsoft's own documented silent switches.
      ; Guessing a switch is what hung setup once before; `/install /quiet
      ; /norestart` is documented, not guessed.
      ; `IfSilent` is a core NSIS instruction rather than LogicLib's
      ; `${If} ${Silent}`: LogicLib only reaches this file because another
      ; include happens to pull it in, and a macro that silently stops
      ; compiling because an unrelated file changed is not a dependency worth
      ; having.
      IfSilent redist_quiet redist_visible
      redist_quiet:
        ExecWait '"$2" /install /quiet /norestart' $0
        Goto redist_ran
      redist_visible:
        ExecWait '"$2" /norestart' $0
      redist_ran:
      DetailPrint "Visual C++ runtime installer finished (code $0)."
      ; Recorded so the uninstaller knows this one arrived with HARE. A
      ; runtime that was already on the PC belongs to whatever put it there.
      WriteRegDWORD HKLM "Software\HARE" "RedistInstalledByHare" 1
  redist_done:

  ; The runtime installer is 25 MB and is finished with the moment ExecWait
  ; returns. Leaving it in Program Files for the life of the installation is
  ; 25 MB of nothing, so it goes. (The PawnIO installer stays: Settings
  ; re-uses that exact file for the in-app "install the driver" button, and
  ; for the fallback below if the silent install doesn't take.)
  Delete "$INSTDIR\resources\redist\vc_redist.x64.exe"
  RMDir "$INSTDIR\resources\redist"

  ; Already present -- a previous HARE, or the user installed it themselves.
  Call CheckPawnIO
  StrCmp $PawnIOPresent "yes" pawnio_done 0

  StrCpy $1 "$INSTDIR\resources\pawnio\PawnIO-Setup.exe"
  IfFileExists "$1" 0 pawnio_done

  ; Installed silently, with the switch PawnIO's own publisher declares.
  ;
  ; An earlier version guessed at three slash-style switches (/S, /VERYSILENT
  ; and friends), waited for each, and hung setup on a modal error dialog
  ; nobody could see. The lesson taken from that was "never guess a switch" --
  ; which was right -- but the conclusion drawn was that no silent switch
  ; existed, which was wrong. PawnIO's switch is dash-style, and it is
  ; declared by the publisher in PawnIO's own winget manifest in
  ; microsoft/winget-pkgs:
  ;
  ;   Silent: -install -silent
  ;
  ; That matters for two reasons. An unattended install (`winget install`,
  ; which passes /S) can now install the driver instead of skipping it. And
  ; an ordinary install no longer leaves PawnIO's window sitting on top of
  ; HARE's finish page, where people closed HARE's installer by mistake or
  ; assumed setup had stalled.
  ;
  ; Waiting is safe now in a way it was not before: a silent installer has no
  ; window to block on.
  DetailPrint "Installing the PawnIO driver (motherboard and RAM lighting)..."
  ExecWait '"$1" -install -silent' $0
  DetailPrint "PawnIO installer finished (code $0)."

  ; Did it actually install? The exit code is not the answer on its own --
  ; reporting success while nothing happened is a failure this project has
  ; shipped before, twice. The service either exists now or it does not.
  Call CheckPawnIO
  StrCmp $PawnIOPresent "yes" pawnio_installed 0

  ; It didn't take. Fall back to exactly the old behaviour: launch the
  ; installer visibly, without waiting, so a person can click through it. An
  ; unattended install has nobody to click, so it is left to HARE's own
  ; Settings > Hardware page instead -- a path that already exists and is
  ; already tested.
  IfSilent pawnio_silent_gaveup 0
    DetailPrint "Silent install didn't take -- opening the PawnIO installer."
    Exec '"$1"'
    Goto pawnio_installed
  pawnio_silent_gaveup:
    DetailPrint "PawnIO didn't install. It can be installed from Settings > Hardware."
    Goto pawnio_done

pawnio_installed:
  ; Recorded so the uninstaller knows this one is ours to remove. Without the
  ; marker the uninstaller leaves every PawnIO alone, which is the safe
  ; default -- and which meant a driver HARE installed was never cleaned up.
  WriteRegDWORD HKLM "Software\HARE" "PawnIOInstalledByHare" 1

pawnio_done:
!macroend

; Custom NSIS steps for the HARE installer.
;
; HARE installs per-user and unelevated, so there is no UAC prompt when
; installing and none when launching. The only thing that ever needs
; administrator rights is the optional scheduled task that starts OpenRGB
; with SMBus access, and the user opts into that from inside the app
; (see electron/backend/elevationHelper.ts) -- not here.
;
; What this file is really for is the other half of that promise: making sure
; an uninstall leaves absolutely nothing behind. Anything HARE creates
; outside its own install directory has to be removed here explicitly,
; because NSIS only removes what it installed.

!macro customUnInstall
  ; Same as customInstall: without this the uninstaller's log is empty too.
  SetDetailsPrint listonly
  DetailPrint "Removing what HARE installed..."

  ; --- 1. The elevated scheduled task -------------------------------------
  ; Removing it needs the same rights that created it. The uninstaller is not
  ; elevated, so this is raised through PowerShell exactly the way the app
  ; does it. If the user declines the prompt, or the task was never created,
  ; this is a harmless no-op -- hence no error handling: there is nothing
  ; useful to tell the user at uninstall time, and failing the uninstall over
  ; it would be worse than leaving one inert task entry.
  ;
  ; Keep this task name in step with OPENRGB_TASK_NAME in elevationHelper.ts.
  ; Uses the scheduled-task cmdlet rather than schtasks for the same reason the
  ; app does (see electron/backend/elevationHelper.ts): nothing has to be
  ; quoted inside anything else, which is what broke the original version.
  ;
  ; NOTE THE $$ IN "-Confirm:$$false". NSIS reads `$name` as one of its own
  ; variables, so a bare `$false` is an unknown-variable warning -- and
  ; electron-builder compiles NSIS with warnings as errors, so it fails the
  ; whole installer build rather than the line. `$$` is NSIS's escape for a
  ; literal dollar; PowerShell receives `-Confirm:$false` as intended.
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath ''powershell.exe'' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @(''-NoProfile'',''-Command'',''Unregister-ScheduledTask -TaskName ''''HARE OpenRGB Access'''' -Confirm:$$false'')"'
  Pop $0

  ; --- 1b. The PawnIO driver, but only if HARE installed it ---------------
  ; The marker is written during install and only when HARE was the one that
  ; put the driver there. A PawnIO the user already had may well be driving
  ; FanControl or a hardware monitor right now, and removing it would break
  ; them -- "leave nothing behind" means nothing of *ours*, not nothing at all.
  ;
  ; Every dollar below is doubled: NSIS reads `$name` as one of its own
  ; variables, so a bare PowerShell `$_` would be an unknown-variable warning,
  ; and electron-builder compiles NSIS with warnings as errors.
  ReadRegDWORD $0 HKLM "Software\HARE" "PawnIOInstalledByHare"
  StrCmp $0 "1" 0 skip_pawnio
    DetailPrint "Removing the PawnIO driver HARE installed..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -Command "$$keys = @(''HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'',''HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*''); $$app = Get-ItemProperty $$keys -ErrorAction SilentlyContinue | Where-Object { $$_.DisplayName -like ''PawnIO*'' } | Select-Object -First 1; if ($$app -and $$app.UninstallString) { Start-Process -FilePath ''cmd.exe'' -ArgumentList ''/c'',$$app.UninstallString }"'
    Pop $0
  skip_pawnio:
  DeleteRegValue HKLM "Software\HARE" "PawnIOInstalledByHare"

  ; --- 2. Stop the OpenRGB that HARE started ------------------------------
  ; Filtered on the install directory, so a separately installed OpenRGB the
  ; user runs themselves is left strictly alone.
  ;
  ; This used to be `taskkill /IM OpenRGB.exe /FI "IMAGENAME eq OpenRGB.exe"`,
  ; which says the same thing twice and filters nothing -- it force-killed the
  ; user's own copy while a comment claimed it didn't.
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -Command "Get-Process OpenRGB -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like ''$INSTDIR\*'' } | Stop-Process -Force"'
  Pop $0

  ; --- 3. User data -------------------------------------------------------
  ;
  ; NOTE THE SHELL VAR CONTEXT. This is a per-machine install, so NSIS runs
  ; the uninstaller with `SetShellVarContext all` -- under which `$APPDATA` is
  ; C:\ProgramData, not the user's Roaming folder. The previous version
  ; deleted C:\ProgramData\HARE, which has never existed, and every setting,
  ; saved look, log and installed module survived every uninstall.
  SetShellVarContext current

  ; Settings, gallery, saved per-device lighting, logs, installed add-on
  ; modules, and Electron's own caches -- all under one directory on purpose,
  ; so removing HARE removes them with no special-casing.
  RMDir /r "$APPDATA\HARE"

  ; The installer copies its whole 150 MB self here during installation
  ; (electron-builder does this for a future updater to reuse). Nothing else
  ; removes it.
  RMDir /r "$LOCALAPPDATA\hare-updater"

  ; The in-app driver installer's scratch directory.
  RMDir /r "$TEMP\hare-pawnio"

  ; --- 3b. OpenRGB's own settings, but only if HARE created them ----------
  ; HARE runs OpenRGB without a config path of its own, deliberately, so that
  ; HARE and a standalone OpenRGB share one set of profiles rather than
  ; fighting over the hardware with two. That means %APPDATA%\OpenRGB may be
  ; the user's, from before HARE existed -- so the app records which it was,
  ; the first time it ever starts OpenRGB (see openrgbBackend.ts).
  ReadRegDWORD $0 HKCU "Software\HARE" "OpenRgbConfigCreatedByHare"
  StrCmp $0 "1" 0 skip_openrgb_config
    DetailPrint "Removing the OpenRGB settings HARE created..."
    RMDir /r "$APPDATA\OpenRGB"
  skip_openrgb_config:

  ; --- 4. Registry --------------------------------------------------------
  ; The launch-at-startup entry. The app writes it under an explicit name
  ; (RUN_KEY_VALUE_NAME in main.ts) rather than letting Electron derive one
  ; from the AppUserModelId; the older names are deleted too, so an install
  ; that predates that change doesn't leave a startup entry pointing at a
  ; program that no longer exists.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HARE"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.HARE"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.ravitzcomputers.hare"
  ; Windows records whether the user disabled that entry in a second place,
  ; and an orphan here shows up in Task Manager's Startup tab forever.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "HARE"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "electron.app.HARE"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.ravitzcomputers.hare"

  ; HARE's own per-user key, once the markers above have been read.
  DeleteRegValue HKCU "Software\HARE" "OpenRgbConfigCreatedByHare"
  DeleteRegKey /ifempty HKCU "Software\HARE"

  SetShellVarContext all

  ; --- 5. The Visual C++ runtime, if HARE installed it --------------------
  ; Asked rather than assumed, and the default is No.
  ;
  ; Everything else here is HARE's alone. This one isn't: the Microsoft
  ; runtime is a shared system component, and any program installed since
  ; HARE may now depend on the copy HARE put there. Removing it silently
  ; could break software that has nothing to do with HARE, which is a worse
  ; outcome than leaving 25 MB of Microsoft's on a PC that will almost
  ; certainly want it again.
  ReadRegDWORD $0 HKLM "Software\HARE" "RedistInstalledByHare"
  StrCmp $0 "1" 0 skip_redist
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "HARE installed the Microsoft Visual C++ runtime.$\r$\n$\r$\nOther programs may be using it now. Remove it as well?$\r$\n$\r$\nIf you're not sure, choose No -- it's a standard Windows component and takes up very little space." \
      IDNO skip_redist
    DetailPrint "Removing the Visual C++ runtime HARE installed..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -Command "$$keys = @(''HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'',''HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*''); Get-ItemProperty $$keys -ErrorAction SilentlyContinue | Where-Object { $$_.DisplayName -like ''Microsoft Visual C++ 2*X64*'' -and $$_.QuietUninstallString } | ForEach-Object { Start-Process -FilePath ''cmd.exe'' -ArgumentList ''/c'',$$_.QuietUninstallString -Wait }"'
    Pop $0
  skip_redist:
  DeleteRegValue HKLM "Software\HARE" "RedistInstalledByHare"
  DeleteRegKey /ifempty HKLM "Software\HARE"
!macroend
