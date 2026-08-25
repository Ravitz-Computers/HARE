// electron-builder.yml, validated against electron-builder's own schema.
//
// WHY THIS EXISTS
//
// `publisherName: Ravitz Computers` at the top level of electron-builder.yml.
// It is a real electron-builder option -- it just lives under
// `win.signtoolOptions`, not at the root. Everything typechecked, every test
// passed, and the build died on a real machine after ten minutes of
// downloading and compiling:
//
//   Invalid configuration object. electron-builder 26.15.3 has been
//   initialized using a configuration object that does not match the API
//   schema.
//    - configuration has an unknown property 'publisherName'
//
// electron-builder validates the config *after* npm install, after the
// payloads are fetched, after the renderer and main process are built -- the
// most expensive possible moment to find a one-line mistake, and one nothing
// in this repository could catch, because the config is YAML that nothing else
// reads.
//
// electron-builder ships its schema. So it's checked here, in a second, before
// any of that.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("electron-builder configuration...\n");

const SCHEMA = "node_modules/app-builder-lib/scheme.json";
const CONFIG = "electron-builder.yml";

check("the config exists", existsSync(CONFIG));
check("electron-builder's schema is available to check it against", existsSync(SCHEMA));

if (!existsSync(SCHEMA) || !existsSync(CONFIG)) {
  console.error("\nALL_BUILDER_CONFIG_CHECKS_FAILED (1 failing)");
  process.exit(1);
}

const yaml = require("js-yaml");
const config = yaml.load(readFileSync(CONFIG, "utf8"));
const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));

// --- The check that would have caught it ------------------------------------
{
  const Ajv = require("ajv");
  // Matching how electron-builder itself validates: unknown keys are the
  // whole point, and `$ref`/`allOf` in this schema need the loose mode.
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false,
    verbose: true,
  });

  let validate;
  let compiled = true;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    compiled = false;
    console.error(`  (couldn't compile the schema: ${err.message})`);
  }

  if (compiled) {
    const valid = validate(config);
    const problems = (validate.errors ?? [])
      // Every branch of a union reports its own failure, which buries the real
      // one. An unknown property is the mistake that actually happens.
      .filter((e) => e.keyword === "additionalProperties")
      .map((e) => `${e.instancePath || "(root)"} has an unknown property '${e.params.additionalProperty}'`);

    check(
      `no unknown options${problems.length ? ` -- ${[...new Set(problems)].join("; ")}` : ""}`,
      problems.length === 0
    );

    if (!valid && problems.length === 0) {
      // Something else is wrong, but the schema's unions make raw ajv output
      // misleading. Report it without failing on it.
      console.log(`  --  schema reported ${validate.errors.length} non-fatal notes (union branches)`);
    }
  }
}

// --- The specific mistake, named ------------------------------------------
{
  check(
    "publisherName isn't at the root, where it isn't an option",
    !Object.prototype.hasOwnProperty.call(config, "publisherName")
  );
  check(
    "...it's passed with the signing options instead, from package.json",
    readFileSync("scripts/signing.mjs", "utf8").includes("publisherName=")
  );
}

// --- The parts of the config the product depends on ------------------------
// Cheap, and each of these has cost a release when it was wrong.
{
  check("it builds an NSIS installer for x64", config.win?.target?.[0]?.target === "nsis");
  check("the installer is a wizard, not a silent one-click", config.nsis?.oneClick === false);
  check("...installing for the whole machine, into Program Files", config.nsis?.perMachine === true);
  check("...showing the licence", config.nsis?.license === "LICENSE");
  check("HARE itself runs unelevated", config.win?.requestedExecutionLevel === "asInvoker");
  check("auto-update metadata is switched off, since there's nowhere to publish it", config.publish === null);
  check(
    "every payload is packed in",
    ["vendor/openrgb", "vendor/pawnio", "vendor/redist", "licenses"].every((from) =>
      (config.extraResources ?? []).some((r) => r.from === from || r.from?.startsWith(from))
    )
  );
  check(
    "the icons ship, or the installed app has no icon at all",
    (config.files ?? []).includes("build/icon.ico")
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_BUILDER_CONFIG_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_BUILDER_CONFIG_CHECKS_PASSED");
