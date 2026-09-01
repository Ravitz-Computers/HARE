# Code signing

How to make Windows show **Ravitz Computers** instead of "Unknown publisher",
what that does and doesn't fix, and what HARE already does about it.

Not legal advice, but an accurate summary of how Windows treats downloaded apps
as of this writing.

## What signing actually buys you

Microsoft Defender SmartScreen judges a download on two things: the reputation
of the **publisher certificate**, and the reputation of that **exact file's
hash**. Two consequences follow, and both surprise people:

- **Signing does not silence the first download.** A brand-new file from a
  brand-new certificate can still warn. Microsoft's own documentation says so.
- **EV certificates no longer bypass SmartScreen.** They used to. That
  behaviour is gone, and paying the premium for EV solely to avoid the warning
  is no longer justified. This is the single most expensive mistake in this
  area.

What signing does buy:

| | First release | After some downloads |
| --- | --- | --- |
| **Unsigned** | "Windows protected your PC", publisher shown as unknown | Reputation restarts from zero on **every new build** |
| **Signed** | May still warn, but shows **Ravitz Computers** as a verified publisher | Warning goes away, and the reputation **carries across future releases** |

That last cell is the whole prize. Unsigned builds never accumulate anything —
every release starts from zero forever. Signed ones build a reputation once and
keep it.

---

## The two routes worth considering

### Azure Artifact Signing — about $10/month, available now

Microsoft's own cloud signing service (called Trusted Signing until recently).
No hardware token, no private key on your machine, and it plugs straight into
a build.

- **Cost:** around $9.99/month for the Basic tier.
- **Who can sign up:** organisations in the USA, Canada, the EU and the UK;
  individual developers in the USA and Canada.
- **Verification:** Microsoft validates the identity first — allow a few
  business days.
- **SmartScreen:** the same reputation-building model as any OV certificate. It
  does not grant instant trust.

This is the fastest route from here to signed, and the one to take unless the
free option lands first.

### SignPath Foundation — free, for open source

[SignPath Foundation](https://signpath.org/) signs qualifying open-source
projects at no cost. The certificate stays with SignPath; you never handle a
private key.

Their conditions, and where HARE stands:

| Condition | HARE |
| --- | --- |
| OSI-approved licence, no commercial dual-licensing | ✅ MIT (`LICENSE`) |
| Source publicly available | ✅ once the repo is public |
| Binaries built from source in a verifiable way — CI, not someone's PC | ✅ `.github/workflows/release.yml` |
| Documented, maintained, and has had a prior release | ⚠️ tag a release first |
| No malware, and ownership can be verified | ✅ |

Order of operations:

1. Make the repo public.
2. Tag a release or two, so there's a track record. The workflow already builds
   in CI and attests provenance, which is the condition most projects get stuck
   on.
3. Apply at <https://signpath.org/apply>.

**The attribution is not optional, and the wording is theirs.** Approved
projects have to carry this line, exactly:

> Free code signing provided by [SignPath.io](https://signpath.io/), certificate
> by [SignPath Foundation](https://signpath.org/).

It's in the README, along with a link to
[`docs/CODE-SIGNING-POLICY.md`](docs/CODE-SIGNING-POLICY.md) — the code signing
policy page they also expect, saying who can approve a signing request, how a
release is built, and what a person can verify for themselves.

---

## Turning it on

**Nothing needs editing.** Signing is worked out at build time from environment
variables (`scripts/signing.mjs`) and passed to electron-builder only when
there's something to sign with. A build with none configured produces an honest
unsigned installer and says so — which is what everyone building HARE who isn't
Ravitz Computers should get.

Check what the next build will do:

```bash
npm run sign:status
```

### Azure Artifact Signing

Set these and build. The three `AZURE_*` names are Microsoft Entra's own, read
by the Azure identity library.

| Variable | What it is |
| --- | --- |
| `HARE_SIGN_AZURE_ENDPOINT` | Your signing account's regional endpoint, e.g. `https://eus.codesigning.azure.net` |
| `HARE_SIGN_AZURE_ACCOUNT` | The Code Signing Account name |
| `HARE_SIGN_AZURE_PROFILE` | The Certificate Profile name |
| `AZURE_TENANT_ID` | Entra tenant |
| `AZURE_CLIENT_ID` | App registration used for signing |
| `AZURE_CLIENT_SECRET` | Its secret |

In GitHub, put the first three in **repository variables** and the three
secrets in **repository secrets**. The release workflow passes them through
already.

Half-configuring this is refused rather than silently producing an unsigned
file — that state looks set up and isn't.

### A certificate file, or one on a token

| Variable | What it is |
| --- | --- |
| `HARE_SIGN_CERT_FILE` | Path to a `.pfx` / `.p12` |
| `HARE_SIGN_CERT_PASSWORD` | Its password |
| `HARE_SIGN_CERT_SUBJECT` | Or: the subject name of a certificate already in the Windows store (this is how HSM and USB-token certificates are used — the key never leaves the device) |
| `HARE_SIGN_CERT_SHA1` | Or: that certificate's thumbprint |

electron-builder's own `CSC_LINK` / `CSC_KEY_PASSWORD` are recognised too.

### SignPath

Set the repository variable `HARE_SIGN_VIA_SIGNPATH` to any value and add
`SIGNPATH_API_TOKEN` and `SIGNPATH_ORG_ID`. SignPath signs the finished
artifact in the workflow rather than during the build, so the build reports
"signed later" instead of claiming it's unsigned.

## What the build guarantees

- If signing **is** configured, the finished installer is checked with
  `Get-AuthenticodeSignature` and **the build fails if it isn't actually
  signed**. A build that was meant to sign and quietly didn't is worse than one
  that never tried, because nobody finds out until it's published.
- If signing **isn't** configured, `build.bat` says so plainly at the end, next
  to the file it just produced.
- The checksum and the build attestation are both taken **after** signing.
  Signing rewrites the file, so anything measured before it describes bytes
  nobody will download.

## Build attestation — free, and already on

Independent of any certificate, every release carries a
[Sigstore](https://www.sigstore.dev/) attestation from
`actions/attest-build-provenance`: cryptographic proof that this exact
installer was produced by this workflow from this commit.

```bash
gh attestation verify HARE-Setup-1.0.0-beta.4.exe --repo Ravitz-Computers/HARE
```

Windows does not read this — it does nothing for SmartScreen. What it does is
let anyone verify a download really came from the repository and wasn't
tampered with. It's also exactly the build integrity SignPath wants to see.

Each release also publishes `SHA256SUMS.txt`.

## Until then

Ship unsigned and say so on the release page. An honest "this isn't signed yet,
here's the prompt you'll see and why" costs less trust than a surprise warning.
[`docs/STATUS.md`](docs/STATUS.md) says it too.
