# Releasing

The production repository is `spellmynameright/bigfight`. The game and room server deploy together to the Fly app `bigfight-online`, served at `https://playbigfight.com/`. `bigfight-arena-preview` is a separate review app.

## Automatic deployment

Both workflows require a configured `GARRISON_RUNNER`, `HEAVY_RUNNER`, or `LHS_RUNNER` repository variable. Jobs are skipped when all three are absent, before GitHub allocates a runner. The fallback in the runner expression does not authorize hosted execution when no variable is set. These variables must name registered garrison runners.

On September 4, 2026, the repository had no runner variables, and the available `derektrimm` credentials had push access but no repository administration permission. The runner API returned 403 on both the local machine and garrison. Automatic deployment therefore requires an administrator to register a runner and set the variable. A skipped workflow is not a successful validation or deployment.

On garrison, using repository-admin credentials:

```bash
~/src/trimmdev/garrison/scripts/register-repo-runners.sh \
  spellmynameright/bigfight garrison-bigfight bigfight-linux 1
gh variable set GARRISON_RUNNER --body bigfight-linux \
  --repo spellmynameright/bigfight
gh api repos/spellmynameright/bigfight/actions/runners \
  --jq '.runners[] | {name, status, labels: [.labels[].name]}'
```

Verify the runner is online and has `bigfight-linux` before relying on the workflows. Keep the existing `FLY_API_TOKEN` repository secret. Fly CLI is installed on garrison; the setup action runs only on a GitHub-hosted runner. A push to `main` then runs validation and deploys its exact SHA. The legacy Pages workflow publishes only the existing redirect.

## Manual validation

When automatic deployment is unavailable, run the same checks on garrison against the exact release commit. Push the completed branch first, then use an isolated directory. Do not modify another checkout or run concurrent builds and browser checks.

```bash
set -euo pipefail
release_sha='<full release commit SHA>'
release_dir="$(mktemp -d /tmp/bigfight-release.XXXXXX)"
git clone --no-checkout git@github.com:spellmynameright/bigfight.git "$release_dir"
git -C "$release_dir" checkout --detach "$release_sha"
cd "$release_dir"
test "$(git rev-parse HEAD)" = "$release_sha"
uptime
timeout --kill-after=15s 15m nice -n 19 ionice -c3 taskset -c 10,11 bash -euo pipefail <<'CHECKS'
npm ci
npx playwright install chromium
npm run check
node --import tsx --test src/mockup/styles/motion.test.ts src/rigs/ApprovedRig.test.ts
npm run server:test
npm run net:unit
npm run net:test
npm run net:lobby-test
npm run net:ui-test
node scripts/replay-ci.mjs
CHECKS
```

The browser checks use ports 4174, 4175, 4176, 4178, and 4188. Check these are free before starting. Garrison has 12 logical CPUs; the command confines this run to CPUs 10 and 11. Adjust only if the machine topology changes. The existing Playwright Chromium revision 1223 matches the lockfile's Playwright 1.60.0. Garrison runs CachyOS and already has the browser's shared libraries. If dependencies change, provision missing libraries through its system package manager. The self-hosted workflow installs the browser without `--with-deps`, which expects Debian-family package tools unavailable on garrison.

Leave `BASE_PATH` unset for these checks: the network and replay scripts exercise `/bigfight/`, and replay builds its own production bundle. Save the command output and its exit status. A timeout, skipped check, or failed command is a failed validation. Ensure the run's browser and server processes have stopped before handing over a playtest link.

## Deploy the landed commit

After validation passes, land the validated commit on `main`. Fetch again and verify the remote SHA before deploying. If landing changes the tested source, validate that resulting source before deployment. Use a clean checkout of the landed commit on the machine with existing Fly authentication.

```bash
set -euo pipefail
git fetch origin main
release_sha="$(git rev-parse origin/main)"
test "$(git rev-parse HEAD)" = "$release_sha"
test -z "$(git status --porcelain)"
timeout --kill-after=15s 10m nice -n 19 ionice -c3 flyctl deploy . \
  --config server/fly.toml --app bigfight-online --remote-only --ha=false \
  --build-arg "RELEASE_ID=$release_sha"
flyctl scale count 1 --app bigfight-online -y
```

The Docker build sets `BASE_PATH=/`. Deploy from the repository root using the Dockerfile configured in `server/fly.toml`; do not pass a second Dockerfile path. Keep one production machine because rooms are held in memory.

Verify the deployed artifact, not just the deploy command's success:

```bash
curl --fail --silent --show-error "https://playbigfight.com/version.json?release=$release_sha" \
  | node -e 'let data=""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => { const version = JSON.parse(data); if (version.releaseId !== process.argv[1]) process.exit(1); console.log(version); });' "$release_sha"
curl --fail --silent --show-error --output /dev/null https://playbigfight.com/healthz
curl --fail --silent --show-error --output /dev/null https://playbigfight.com/
```

For automatic deployment, also check that the watched Actions run has `headSha` equal to `origin/main`. Report manual validation and manual deployment as such when the workflows were skipped.
