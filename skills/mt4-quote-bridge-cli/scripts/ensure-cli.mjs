#!/usr/bin/env node
// Puts the `mt4-quote-bridge` CLI this skill was written for on PATH.
// `npx skills add` copies only the skill folder, so the skill installs its own CLI: when the command is missing or
// older than REQUIRED, npm builds it from GitHub (the package's `prepare` script) and installs it globally.
// Prints one line on stdout: `ready <version>`. Exits 1 with the reason on stderr when it cannot.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED = "0.2.0"; // kept equal to package.json's version by tests/cli.test.ts
const SOURCE = process.env.MT4QB_CLI_SOURCE || "github:ross-jill-ws/mt4-quote-bridge-cli";
const NODE = "22.12.0";

// npm and npm-installed commands are .cmd shims on Windows, which only a shell runs.
const run = (command, stdio) => spawnSync(command, { shell: true, encoding: "utf8", stdio });

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

function installed() {
  const r = run("mt4-quote-bridge --version", "pipe");
  return r.status === 0 ? /^(\d+\.\d+\.\d+)/.exec(r.stdout.trim())?.[1] : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

let version = installed();
if (version && newer(version, REQUIRED)) {
  console.log(`ready ${version}`);
  process.exit(0);
}

if (!newer(process.versions.node, NODE))
  fail(`mt4-quote-bridge needs Node.js ${NODE} or newer; this is ${process.versions.node}. Ask the user to upgrade Node.js.`);

console.error(
  version
    ? `mt4-quote-bridge ${version} is older than ${REQUIRED}; updating from ${SOURCE}…`
    : `mt4-quote-bridge is not installed; installing from ${SOURCE}…`
);
// Not `npm install --global <git url>`: npm hands --global on to the install that prepares a git dependency, so its
// devDependencies never reach the clone and the build finds no TypeScript. `npm pack` builds the clone as a plain
// project; the tarball it leaves already holds dist/, so the global install has nothing to build.
// npm's own output goes to stderr, so stdout stays the one result line.
const quiet = ["ignore", process.stderr, process.stderr];
const dir = mkdtempSync(join(tmpdir(), "mt4qb-"));
try {
  const pack = run(`npm pack ${SOURCE} --pack-destination "${dir}"`, quiet);
  if (pack.status !== 0) fail(`npm pack ${SOURCE} failed (exit ${pack.status}); npm's message is above.`);
  const tarball = join(dir, readdirSync(dir).find((f) => f.endsWith(".tgz")));
  const npm = run(`npm install --global "${tarball}"`, quiet);
  if (npm.status !== 0)
    fail(
      `npm install --global failed (exit ${npm.status}). If npm reported EACCES, the user's global npm folder is not ` +
        "writable: they can set a user-owned one with `npm config set prefix ~/.npm-global` and add its bin to PATH."
    );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

version = installed();
if (!version)
  fail(
    "The install finished but `mt4-quote-bridge` is not on PATH. Ask the user to add npm's global bin folder " +
      "(`npm prefix --global`, plus /bin outside Windows) to PATH."
  );
if (!newer(version, REQUIRED))
  fail(`${SOURCE} still provides mt4-quote-bridge ${version}; this skill needs ${REQUIRED} or newer.`);
console.log(`ready ${version}`);
