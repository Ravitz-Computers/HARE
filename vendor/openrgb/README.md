# vendor/openrgb

A portable Windows build of [OpenRGB](https://openrgb.org/) goes here, and is
packaged inside `HARE-Setup.exe` so that installing HARE installs everything.

**You do not normally put anything here by hand.** `build.bat` fetches it,
verifies it and flattens it into this folder (see `scripts/build.ps1`), and
`npm run openrgb:stage` does the same from Node. The build refuses to package
an installer if `OpenRGB.exe` isn't here — see `scripts/verify-bundle.mjs`.

If you do need to do it manually: download the **Windows 64-bit portable zip**
from <https://openrgb.org/> or
<https://codeberg.org/OpenRGB/OpenRGB/releases>, and unzip it so that
`OpenRGB.exe` sits directly in this folder, alongside its DLLs and its
`plugins/` directory.

Nothing in here is committed. OpenRGB is GPL-2.0 and is redistributed
unmodified; its licence and the offer of corresponding source travel with
every copy of HARE — see `LICENSE-NOTES.md`.
