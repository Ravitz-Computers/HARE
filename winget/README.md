# Publishing HARE to winget

`winget install RC.HareRGB` — how that happens, and what breaks it.

```bash
npm run winget -- --dry-run                       # write the manifests, submit nothing
npm run winget                                    # write them and print how to test them
npm run winget -- --submit                        # open the pull request
```

Everything is derived from `package.json` and the GitHub release. The only
thing you pass by hand is a different version or URL:

| Flag | Default |
| --- | --- |
| `--version 1.0.0-beta.4` | `package.json`'s version |
| `--tag v1.0.0-beta.4` | `v` + the version |
| `--url <installer url>` | the release asset for that tag |
| `--dry-run` | off |
| `--submit` | off |

Manifests land in `winget/generated/<version>/`. That folder is generated —
edit the script, not the files.

---

## The order things have to happen in

1. **Publish the release.** Not a draft. Microsoft's validation pipeline
   downloads the installer from the URL in the manifest, and a draft release's
   assets are not public.
2. **Run `npm run winget`.** It downloads the published installer and hashes
   those exact bytes. A hash taken from `release/` on the build machine is a
   different file — different timestamps, and a different signature once
   signing is on — and it passes every local check before failing in
   Microsoft's pipeline hours later.
3. **Test it on Windows**, from the printed commands:

   ```
   winget validate --manifest winget/generated/1.0.0-beta.4
   winget install --manifest winget/generated/1.0.0-beta.4
   ```

   Use a throwaway VM or Windows Sandbox for the second one. It really installs.
4. **Submit.** `npm run winget -- --submit`, with a token in the environment.

---

## The first submission

`wingetcreate submit` takes finished manifests and opens the pull request, and
it does that whether or not the package already exists — so the same
`npm run winget -- --submit` works for the first version and every one after
it. It forks microsoft/winget-pkgs into your account, puts the three files at
`manifests/r/RC/HareRGB/<version>/`, and opens the PR.

What is *not* an option for the first version is the **winget-releaser** GitHub
Action, which is the usual way to automate this from a release workflow. It can
only add versions to a package that is already in the repository. Adding it to
`.github/workflows/release.yml` is worth doing once `RC.HareRGB` has been merged
once.

Doing it by hand is also fine — copy the three generated files to
`manifests/r/RC/HareRGB/<version>/` in a fork and open the pull request yourself.
The four-level path is the only part that's easy to get wrong.

---

## The token

`HARE_WINGET_TOKEN`, or `GITHUB_TOKEN` if that isn't set.

It must be a **classic** personal access token with the **`public_repo`**
scope. Fine-grained tokens do not work here: the tool forks
microsoft/winget-pkgs into your account and pushes a branch to that fork, and a
fine-grained token can't be granted rights over a repository that doesn't exist
when the token is made.

```powershell
$env:HARE_WINGET_TOKEN = "ghp_..."
npm run winget -- --submit
```

---

## What reviewers push back on

**The identifier.** `RC.HareRGB` reads as `Publisher.Package`, and `RC` is an
abbreviation only Ravitz Computers reads as Ravitz Computers. A reviewer may
ask for `RavitzComputers.HARE`. If that happens, set it and regenerate:

```bash
HARE_WINGET_ID=RavitzComputers.HARE npm run winget
```

An identifier can be changed freely before the first merge and is painful to
change after, so agree on it in the first pull request.

**The signature.** The pipeline installs HARE in a sandbox. An unsigned
installer trips SmartScreen there the same way it does on a real PC, which
usually means a human reviewer looks at it rather than an automatic merge. See
`SIGNING.md`.

**The silent install.** Validation runs the installer with the switches in the
manifest and fails if a window is still on screen at the end. HARE's two child
installers are handled in `build/installer.nsh`, each with the switch its own
publisher documents: `/install /quiet /norestart` for the Visual C++ runtime,
and `-install -silent` for the PawnIO driver. Neither is guessed, and
`test/verify-winget.mjs` checks both are still true.

---

## What an unattended install gets

All of it. Motherboard and memory lighting needs the PawnIO driver, and the
installer puts that on too — silently, with the switch declared in PawnIO's own
manifest in this same repository. If the driver somehow doesn't take, setup
carries on and the app offers it again from **Settings → Hardware**.
