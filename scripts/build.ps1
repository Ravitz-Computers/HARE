#
# HARE installer builder (Ravitz Computers)
#
# Run via build.bat at the project root - not meant to be double-clicked
# directly.
#
# What it produces is ONE FILE: release\HARE-Setup-<version>.exe. That file
# contains HARE, OpenRGB, the Visual C++ runtime OpenRGB needs, and the
# PawnIO driver. Copy it to any Windows PC, double-click, done - there is
# nothing else to download and no second step. Building it is a one-time job
# for whoever distributes HARE; everyone else just runs the .exe.
#
# The build refuses to finish if any of those payloads is missing, because an
# installer that quietly leaves one out installs fine and then finds no
# hardware, which looks exactly like HARE being broken.
#
# Runs elevated (admin) -- confirmed necessary on real hardware: Windows
# only grants the filesystem symlink permission electron-builder's Windows
# packaging step needs to elevated processes (or accounts with Developer
# Mode on, which most PCs don't have enabled), and separately, HARE's own
# installed app also needs to run elevated for OpenRGB to get the
# SMBus/hardware access most motherboard/RAM RGB controllers require. See
# the elevation check below and win.requestedExecutionLevel in
# electron-builder.yml.
#
# Safe to re-run any time: every step below skips itself if its output
# already exists.

param(
    # Skips the "install it here too?" question, for a machine that is only
    # ever used to build the installer for other people.
    [switch]$NoInstall
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is much faster with the progress bar off.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# Re-launch elevated if we're not already -- do this before anything else
# (before Start-Transcript too, so only the elevated instance writes the
# log, keeping it a single clean file). The WindowsPrincipal/WindowsIdentity
# APIs only exist on Windows (this script is Windows-only by design), but
# the try/catch keeps this from hard-failing in unexpected hosts instead of
# just silently skipping the check it actually needs.
try {
    $isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {
    # Write-Warn isn't defined yet this early in the script -- plain Write-Host here.
    Write-Host "[!] Couldn't determine administrator status (unexpected on Windows) -- continuing without elevating." -ForegroundColor Yellow
    $isElevated = $true
}
if (-not $isElevated) {
    Write-Host "HARE's build needs administrator access (Windows requires it for the installer packaging step, and for OpenRGB to reach most RGB hardware) -- requesting it now..." -ForegroundColor Yellow
    try {
        # The switch has to be carried across, or the elevated copy stops to
        # ask a question nobody is watching for.
        $relaunchArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
        if ($NoInstall) { $relaunchArgs += "-NoInstall" }
        $proc = Start-Process -FilePath "powershell.exe" `
            -ArgumentList $relaunchArgs `
            -Verb RunAs -Wait -PassThru
        exit $proc.ExitCode
    } catch {
        Write-Host ""
        Write-Host "[ERROR] Administrator access is required and the prompt wasn't accepted. Right-click build.bat and choose 'Run as administrator', then try again." -ForegroundColor Red
        exit 1
    }
}

# Every run writes a full log of everything printed to the screen (including
# npm/electron-builder's own output) to build.log in the project root, so if
# something goes wrong there's always a single file to send along instead of
# having to copy-paste from a scrollback buffer. Non-fatal if this fails for
# some reason (e.g. build.log is open in another program) -- logging should
# never be the thing that blocks an actual build.
$LogPath = Join-Path $Root "build.log"
$TranscriptStarted = $false
try {
    Start-Transcript -Path $LogPath -Force -ErrorAction Stop | Out-Null
    $TranscriptStarted = $true
} catch {
    Write-Host "[!] Couldn't create build.log (maybe it's open in Notepad or another program?) -- continuing without a log file." -ForegroundColor Yellow
}
function Stop-BuildLog { if ($TranscriptStarted) { try { Stop-Transcript | Out-Null } catch {} } }

# npm/electron-builder draw colored, spinner-style progress output on a real
# interactive console using ANSI/cursor-control codes. Start-Transcript in
# Windows PowerShell can lose or garble that into blank lines instead of
# capturing the actual text -- exactly the kind of gap that swallows the one
# error message you actually need to see. Asking these tools for plain,
# non-interactive output sidesteps the problem instead of trying to capture
# something that was never reliably capturable in the first place.
$env:CI = "true"
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"

# Runs a native command (npm, electron-builder, etc.) with stdout+stderr
# merged and funneled line-by-line through Write-Host, which -- unlike raw
# passthrough console output -- Start-Transcript reliably captures. Returns
# the real exit code so callers can check it explicitly instead of relying
# on $LASTEXITCODE surviving untouched through a pipeline.
function Invoke-Logged {
    param(
        [Parameter(Mandatory)] [string]$Command,
        [Parameter(Mandatory)] [string[]]$Arguments
    )
    # Native commands (npm especially) routinely write ordinary, non-fatal
    # text to stderr -- npm's "npm warn deprecated ..." notices, for
    # example. Merging that into the pipeline with 2>&1 turns each stderr
    # line into a PowerShell ErrorRecord, and with $ErrorActionPreference =
    # "Stop" set globally (see the top of this script), Windows PowerShell
    # 5.1 escalates that into an immediate terminating error the instant
    # npm prints its very first ordinary warning -- aborting the whole
    # build before the ForEach-Object below ever runs, let alone npm
    # actually finishing. Confirmed on a real Windows 10 PC running
    # PowerShell 5.1.26100.9168 Desktop from an actual build.log; this
    # doesn't reproduce under PowerShell 7/pwsh (the only engine available
    # to test with in this project's dev sandbox), which is how it slipped
    # through earlier testing here. Scoping ErrorActionPreference to
    # "Continue" for just this call keeps stderr lines as plain pipeline
    # data -- handled explicitly below -- instead of letting them escalate.
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command @Arguments 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Host $_.Exception.Message
            } else {
                Write-Host $_
            }
        }
    } finally {
        $ErrorActionPreference = $previousEap
    }
    return $LASTEXITCODE
}

$PinnedNodeVersion = "22.22.2"
# Known-good pinned fallback in case the Codeberg release API below is ever
# unreachable or changes shape. Update this occasionally; it only matters
# when the dynamic lookup fails. Kept in sync by hand with the same
# fallback in electron/backend/deviceDatabase.ts.
$PinnedOpenRgbVersion = "release_candidate_1.0rc3"
$PinnedOpenRgbUrl = "https://codeberg.org/OpenRGB/OpenRGB/releases/download/release_candidate_1.0rc3/OpenRGB_1.0rc3_Windows_64_6fbcf62.zip"

function Write-Step($msg) { Write-Host ""; Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "      $msg" -ForegroundColor DarkGray }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }

function Resolve-NodeJs {
    $existing = Get-Command node -ErrorAction SilentlyContinue
    if ($existing) {
        try {
            $verStr = ((& node --version) -replace '^v', '').Trim()
            $major = [int]($verStr.Split('.')[0])
        } catch {
            $major = 0
        }
        if ($major -ge 18) {
            Write-Ok "Found Node.js v$verStr already installed on this PC."
            return Split-Path $existing.Source -Parent
        }
        Write-Warn "Found Node.js v$verStr, but HARE needs v18 or newer. Downloading a private copy instead."
    } else {
        Write-Warn "Node.js isn't installed. Downloading a private copy just for HARE (no admin rights needed)."
    }

    $toolsDir = Join-Path $Root "tools"
    $nodeDir = Join-Path $toolsDir "node-v$PinnedNodeVersion-win-x64"
    $nodeExe = Join-Path $nodeDir "node.exe"

    if (-not (Test-Path $nodeExe)) {
        New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
        $zipUrl = "https://nodejs.org/dist/v$PinnedNodeVersion/node-v$PinnedNodeVersion-win-x64.zip"
        $zipPath = Join-Path $toolsDir "node.zip"
        Write-Info "Downloading Node.js v$PinnedNodeVersion..."
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
        Write-Info "Extracting..."
        Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
        Remove-Item $zipPath -Force
    }

    if (-not (Test-Path $nodeExe)) {
        throw "Downloaded Node.js but $nodeExe still doesn't exist. Check your internet connection and try again."
    }
    Write-Ok "Using a private copy of Node.js v$PinnedNodeVersion (installed only inside this project, not system-wide)."
    return $nodeDir
}

<#
    Downloads one file, with Windows' own HTTP stack.

    Node's fetch is what the manifest scripts reach for, and on a lot of real
    machines it is the thing that fails: a corporate proxy, a TLS-inspecting
    antivirus, an old certificate store. Invoke-WebRequest inherits the
    machine's proxy and certificate settings, so this is the path that works
    where the other one doesn't. The manifests hash whatever lands here, so
    nothing is trusted just because it arrived.
#>
function Get-Payload {
    param(
        [string]$Url,
        [string]$Destination,
        [string]$Label,
        [int]$MinimumBytes
    )

    if ((Test-Path $Destination) -and ((Get-Item $Destination).Length -ge $MinimumBytes)) {
        Write-Ok "$Label is already downloaded."
        return $true
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
    Write-Info "Downloading $Label..."
    try {
        $previous = $ProgressPreference
        $ProgressPreference = "SilentlyContinue"
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -MaximumRedirection 10
        } finally {
            $ProgressPreference = $previous
        }
    } catch {
        Write-Warn "Couldn't download $Label ($($_.Exception.Message))."
        if (Test-Path $Destination) { Remove-Item $Destination -Force }
        return $false
    }

    if (-not (Test-Path $Destination) -or (Get-Item $Destination).Length -lt $MinimumBytes) {
        # A blocked download usually arrives as an error page saved under the
        # right name -- present, and useless.
        Write-Warn "$Label downloaded but the file is too small to be real."
        if (Test-Path $Destination) { Remove-Item $Destination -Force }
        return $false
    }

    Write-Ok "$Label is ready."
    return $true
}

function Resolve-PawnIo {
    $dest = Join-Path $Root "vendor\pawnio\PawnIO-Setup.exe"
    # Resolved from the release list so it's whatever is current, with a
    # known-good link behind it when GitHub's API can't be reached.
    $url = $null
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/namazso/PawnIO.Setup/releases/latest" -Headers @{ "User-Agent" = "HARE-build" }
        $asset = $release.assets | Where-Object { $_.name -match '(?i)\.exe$' } | Select-Object -First 1
        if ($asset) { $url = $asset.browser_download_url }
    } catch {
        Write-Info "Couldn't reach the PawnIO release list; using the published installer link."
    }
    if (-not $url) { $url = "https://pawnio.eu/PawnIO-Setup.exe" }
    return (Get-Payload -Url $url -Destination $dest -Label "the PawnIO driver" -MinimumBytes 100000)
}

function Resolve-Redist {
    $dest = Join-Path $Root "vendor\redist\vc_redist.x64.exe"
    return (Get-Payload -Url "https://aka.ms/vs/17/release/vc_redist.x64.exe" -Destination $dest -Label "the Visual C++ runtime" -MinimumBytes 1000000)
}

function Resolve-OpenRgb {
    $openRgbDir = Join-Path $Root "vendor\openrgb"
    $openRgbExe = Join-Path $openRgbDir "OpenRGB.exe"

    if (Test-Path $openRgbExe) {
        Write-Ok "OpenRGB is already set up."
        return
    }

    New-Item -ItemType Directory -Force -Path $openRgbDir | Out-Null

    $downloadUrl = $null
    $downloadedVersion = $null
    try {
        Write-Info "Looking up the latest OpenRGB release..."
        $release = Invoke-RestMethod -Uri "https://codeberg.org/api/v1/repos/OpenRGB/OpenRGB/releases/latest"
        $asset = $release.assets | Where-Object { $_.name -match '(?i)windows_64.*\.zip$' } | Select-Object -First 1
        if ($asset) {
            $downloadUrl = $asset.browser_download_url
            $downloadedVersion = $release.tag_name
        }
    } catch {
        Write-Warn "Couldn't reach the OpenRGB release list, falling back to a known-good link."
    }
    if (-not $downloadUrl) {
        $downloadUrl = $PinnedOpenRgbUrl
        $downloadedVersion = $PinnedOpenRgbVersion
    }

    $zipPath = Join-Path $openRgbDir "openrgb.zip"
    $extractDir = Join-Path $openRgbDir "_extract"
    try {
        Write-Info "Downloading OpenRGB..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
        Write-Info "Extracting..."
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        # The zip sometimes contains OpenRGB.exe directly, sometimes inside a
        # subfolder - find it wherever it landed and flatten it into vendor\openrgb.
        $foundExe = Get-ChildItem -Path $extractDir -Filter "OpenRGB.exe" -Recurse | Select-Object -First 1
        if (-not $foundExe) {
            throw "Downloaded OpenRGB but couldn't find OpenRGB.exe inside the archive."
        }
        Get-ChildItem -Path $foundExe.DirectoryName | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $openRgbDir -Recurse -Force
        }
    } finally {
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    }

    if (-not (Test-Path $openRgbExe)) {
        throw "OpenRGB setup finished but $openRgbExe still doesn't exist."
    }

    # Record which version we just fetched so HARE's built-in device-database
    # check (electron/backend/deviceDatabase.ts) has a baseline to compare
    # future Codeberg releases against, both at startup and via the
    # in-app "Discover" button.
    if ($downloadedVersion) {
        Set-Content -Path (Join-Path $openRgbDir "version.txt") -Value $downloadedVersion -NoNewline
    }

    Write-Ok "OpenRGB is set up."
}

try {
    Write-Step "[1/4] Checking for Node.js..."
    $nodeBinDir = Resolve-NodeJs
    $env:Path = "$nodeBinDir;$env:Path"

    Write-Step "[2/4] Installing HARE's dependencies (first run only, this can take a few minutes)..."
    $npmInstallExit = Invoke-Logged -Command "npm" -Arguments @("install", "--no-fund", "--no-audit")
    if ($npmInstallExit -ne 0) { throw "npm install failed with exit code $npmInstallExit (see the output above)." }
    Write-Ok "Dependencies installed."

    Write-Step "[3/5] Collecting everything the installer has to contain..."
    Resolve-OpenRgb
    $pawnIoOk = Resolve-PawnIo
    $redistOk = Resolve-Redist
    if (-not $pawnIoOk -or -not $redistOk) {
        Write-Info "One of those didn't download. The build will say exactly what's missing in a moment."
    }

    Write-Step "[4/5] Building HARE (this is the slow part)..."
    # Says up front whether the result will be signed, so nobody watches a
    # ten-minute build to find out at the end.
    Invoke-Logged -Command "npm" -Arguments @("run", "sign:status") | Out-Null
    $packageExit = Invoke-Logged -Command "npm" -Arguments @("run", "package:win")
    if ($packageExit -ne 0) { throw "The build/package step failed with exit code $packageExit (see the output above)." }

    Write-Step "[5/5] Checking the finished installer..."
    $installer = Get-ChildItem -Path (Join-Path $Root "release") -Filter "HARE-Setup-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $installer) {
        throw "Build finished but no installer (HARE-Setup-*.exe) was found in the release folder."
    }
    # The payloads add up to well over a hundred megabytes. An installer much
    # smaller than that built without them, whatever else it says.
    $sizeMb = [math]::Round($installer.Length / 1MB, 1)
    if ($installer.Length -lt 120MB) {
        throw "The installer is only $sizeMb MB, which is too small to contain OpenRGB, the Visual C++ runtime and the driver. Something was left out -- check the messages above."
    }
    Write-Ok "$($installer.Name) -- $sizeMb MB, everything inside."

    # Signed or not is the difference between "Windows shows Ravitz Computers"
    # and "Windows protected your PC", so it is said out loud either way rather
    # than left for someone to discover after they have handed the file out.
    $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
    if ($signature.Status -eq "Valid") {
        Write-Ok "Signed by: $($signature.SignerCertificate.Subject)"
    } else {
        Write-Warn "This installer is NOT signed. Windows will show a SmartScreen warning to whoever runs it."
        Write-Info "SIGNING.md explains the options -- Azure Artifact Signing is about `$10 a month, SignPath is free for open source."
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  Your installer is ready:" -ForegroundColor Green
    Write-Host ""
    Write-Host "    $($installer.FullName)"
    Write-Host ""
    Write-Host "  That one file is all anyone needs. Copy it to any Windows PC," -ForegroundColor Green
    Write-Host "  double-click it, and HARE installs -- nothing else to download." -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""

    if (-not $NoInstall) {
        $answer = Read-Host "Install HARE on this PC now as well? [Y/n]"
        if ($answer -eq "" -or $answer -match '^(?i)y') {
            Write-Info "Running $($installer.Name)..."
            Start-Process -FilePath $installer.FullName -Wait
            Write-Ok "HARE is installed. Look for it on your Desktop or in the Start Menu."
        } else {
            Write-Info "Skipped. The installer is still waiting in the release folder."
        }
    }

    # Opening the folder means nobody has to go hunting for the file.
    try { Start-Process -FilePath "explorer.exe" -ArgumentList "/select,`"$($installer.FullName)`"" } catch { }

    Stop-BuildLog
    exit 0
} catch {
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    Stop-BuildLog
    exit 1
}
