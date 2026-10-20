#!/usr/bin/env bash
# Read-only provider collection, shared by CI preflight and protected release.
set -euo pipefail
test "$#" -eq 1
[[ "${REVIEWER_BOT_ID:-}" =~ ^[1-9][0-9]*$ ]]
collector_source="$(git rev-parse HEAD)"
collector_tree="$(git rev-parse 'HEAD^{tree}')"
collector_digest="$(node -e 'const fs=require("node:fs"),c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "${BASH_SOURCE[0]}")"
mkdir "$1"
cd "$1"
failed=0
capture() {
  local name="$1" kind="$2" output="$3" code=0 state=success
  shift 3
  "$@" > "$output" 2> "$output.stderr" || code=$?
  if test "$code" -ne 0; then failed=1; state=failure; fi
  printf '{"name":"%s","kind":"%s","status":"%s","exitCode":%s}\n' "$name" "$kind" "$state" "$code" >> collection-status.jsonl
  return "$code"
}
request() { capture "$1" request "$1.json" "${@:2}"; }
check() { capture "$1" validation "$1.validation.json" "${@:2}"; }
project() { capture "$1" validation "$1.json" "${@:2}"; }
skip() {
  local name
  failed=1
  for name in "$@"; do
    printf '{"name":"%s","kind":"request","status":"skipped","exitCode":null,"reason":"missing-prerequisite"}\n' "$name" >> collection-status.jsonl
  done
}

target="${REVIEWED_SOURCE_SHA:-}"
if request main gh api repos/aviaratech/ai-plugin-tools/commits/main &&
  check main jq -e '(.sha | test("^[a-f0-9]{40}$")) and (.commit.tree.sha | test("^[a-f0-9]{40}$"))' main.json; then
  if test -z "$target"; then target="$(jq -r .sha main.json)"; fi
fi
COLLECTED_SOURCE_SHA="$target" COLLECTOR_SOURCE_SHA="$collector_source" COLLECTOR_SOURCE_TREE="$collector_tree" COLLECTOR_SHA256="$collector_digest" \
  node -e 'const fs=require("node:fs"),e=process.env;fs.writeFileSync("observation.json",JSON.stringify({repository:"aviaratech/ai-plugin-tools",observedAt:new Date().toISOString(),collectedSourceSha:e.COLLECTED_SOURCE_SHA||null,collectorSourceSha:e.COLLECTOR_SOURCE_SHA,collectorSourceTree:e.COLLECTOR_SOURCE_TREE,collectorSHA256:e.COLLECTOR_SHA256}))'

if [[ "$target" =~ ^[a-f0-9]{40}$ ]]; then
  if request associations gh api "repos/aviaratech/ai-plugin-tools/commits/$target/pulls" &&
    project associated-pr jq --arg sha "$target" '[.[] | select(.merged_at != null and .merge_commit_sha == $sha)] | if length == 1 then .[0] else error("ambiguous source PR") end' associations.json &&
    check associated-pr jq -e '.number | numbers | . > 0' associated-pr.json; then
    pr="$(jq -r .number associated-pr.json)"
    if request pr gh api "repos/aviaratech/ai-plugin-tools/pulls/$pr" &&
      check pr jq -e '(.head.sha | test("^[a-f0-9]{40}$")) and (.number | type == "number") and (.base.repo.full_name == "aviaratech/ai-plugin-tools")' pr.json; then
      head="$(jq -r .head.sha pr.json)"
      request head gh api "repos/aviaratech/ai-plugin-tools/git/commits/$head" &&
        check head jq -e '(.sha | test("^[a-f0-9]{40}$")) and (.tree.sha | test("^[a-f0-9]{40}$"))' head.json || :
      if request reviews-raw gh api "repos/aviaratech/ai-plugin-tools/pulls/$pr/reviews?per_page=100" --paginate --slurp &&
        project reviews jq 'add' reviews-raw.json &&
        project review-selection jq --arg bot "$REVIEWER_BOT_ID" '[.[] | select((.user.id | tostring) == $bot)] | sort_by(.id) | last | .node_id // error("configured App review absent")' reviews.json; then
        review="$(jq -r . review-selection.json)"
        request app-review-eligibility gh api graphql -f query='query($id:ID!){node(id:$id){...on PullRequestReview{id fullDatabaseId state authorCanPushToRepository author{login} commit{oid} pullRequest{number headRefOid baseRepository{nameWithOwner}}}}}' -f id="$review" &&
          check app-review-eligibility jq -e '.errors == null and (.data.node | (.id | type == "string") and (.state | type == "string") and (.authorCanPushToRepository | type == "boolean") and (.author.login | type == "string") and (.commit.oid | test("^[a-f0-9]{40}$")) and (.pullRequest.number | type == "number") and (.pullRequest.headRefOid | test("^[a-f0-9]{40}$")) and (.pullRequest.baseRepository.nameWithOwner | type == "string"))' app-review-eligibility.json || :
      else
        skip app-review-eligibility
      fi
      request review-decision gh api graphql -f query='query($n:Int!){repository(owner:"aviaratech",name:"ai-plugin-tools"){pullRequest(number:$n){reviewDecision}}}' -F n="$pr" &&
        check review-decision jq -e '.errors == null and (.data.repository.pullRequest.reviewDecision | type == "string")' review-decision.json || :
    else
      skip head reviews-raw app-review-eligibility review-decision
    fi
  else
    skip pr head reviews-raw app-review-eligibility review-decision
  fi
  request checks-raw gh api "repos/aviaratech/ai-plugin-tools/commits/$target/check-runs?per_page=100" --paginate --slurp &&
    project checks jq '{check_runs:[.[]|.check_runs[]]}' checks-raw.json || :
else
  skip associations pr head reviews-raw app-review-eligibility review-decision checks-raw
fi

# These reads do not depend on source-PR discovery or each other.
request branch gh api repos/aviaratech/ai-plugin-tools/branches/main &&
  check branch jq -e '.name == "main" and (.protected | type == "boolean") and (.commit.sha | test("^[a-f0-9]{40}$"))' branch.json || :
request ref-update-rule gh api graphql -f query='query{repository(owner:"aviaratech",name:"ai-plugin-tools"){nameWithOwner ref(qualifiedName:"refs/heads/main"){name prefix target{oid} refUpdateRule{pattern requiredStatusCheckContexts requiredApprovingReviewCount requiresLinearHistory allowsForcePushes allowsDeletions}}}}' &&
  check ref-update-rule jq -e '.errors == null and (.data.repository.nameWithOwner == "aviaratech/ai-plugin-tools") and (.data.repository.ref | .name == "main" and .prefix == "refs/heads/" and (.target.oid | test("^[a-f0-9]{40}$")) and (.refUpdateRule | (.pattern | type == "string") and (.requiredStatusCheckContexts | type == "array") and (.requiredApprovingReviewCount | type == "number") and (.requiresLinearHistory | type == "boolean") and (.allowsForcePushes | type == "boolean") and (.allowsDeletions | type == "boolean")))' ref-update-rule.json || :
request issue gh api repos/aviaratech/ai-plugin-tools/issues/1 &&
  check issue jq -e '.state == "open" or .state == "closed"' issue.json || :
request publication-history-raw gh api 'repos/aviaratech/ai-plugin-tools/actions/artifacts?name=publish-intent-0.1.0&per_page=100' --paginate --slurp &&
  project publication-history jq '{intents:[.[]|.artifacts[]]}' publication-history-raw.json || :
if request package-status curl --silent --show-error --connect-timeout 15 --output package-body.json --write-out '%{http_code}' https://registry.npmjs.org/@aviaratech%2fai-plugin-tools; then
  project package-registry jq --argjson status "$(cat package-status.json)" '{statusCode:$status,body:.}' package-body.json || :
  check package-registry jq -e '.statusCode == 200 and .body.name == "@aviaratech/ai-plugin-tools" and (.body.maintainers | type == "array")' package-registry.json || :
fi
if request registry-status curl --silent --show-error --connect-timeout 15 --output registry-body.json --write-out '%{http_code}' https://registry.npmjs.org/@aviaratech%2fai-plugin-tools/0.1.0; then
  project registry jq --argjson status "$(cat registry-status.json)" '{statusCode:$status,body:.}' registry-body.json || :
  check registry jq -e '(.statusCode == 200 or .statusCode == 404) and .body != null' registry.json || :
fi
node -e 'const fs=require("node:fs"),r=fs.readFileSync("collection-status.jsonl","utf8").trim().split("\n").map(JSON.parse);console.log(JSON.stringify({records:r.length,failed:r.filter(x=>x.status!=="success")}))'
exit "$failed"
