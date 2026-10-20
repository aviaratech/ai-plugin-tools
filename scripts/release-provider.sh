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
gh api repos/aviaratech/ai-plugin-tools/commits/main > main.json
target="${REVIEWED_SOURCE_SHA:-$(jq -er .sha main.json)}"
[[ "$target" =~ ^[a-f0-9]{40}$ ]]
COLLECTED_SOURCE_SHA="$target" COLLECTOR_SOURCE_SHA="$collector_source" COLLECTOR_SOURCE_TREE="$collector_tree" COLLECTOR_SHA256="$collector_digest" \
  node -e 'const fs=require("node:fs"),e=process.env;fs.writeFileSync("observation.json",JSON.stringify({repository:"aviaratech/ai-plugin-tools",observedAt:new Date().toISOString(),collectedSourceSha:e.COLLECTED_SOURCE_SHA,collectorSourceSha:e.COLLECTOR_SOURCE_SHA,collectorSourceTree:e.COLLECTOR_SOURCE_TREE,collectorSHA256:e.COLLECTOR_SHA256}))'
gh api "repos/aviaratech/ai-plugin-tools/commits/$target/pulls" > associations.json
jq --arg sha "$target" '[.[] | select(.merged_at != null and .merge_commit_sha == $sha)] | if length == 1 then .[0] else error("ambiguous source PR") end' associations.json > pr.json
pr="$(jq -er .number pr.json)"
gh api "repos/aviaratech/ai-plugin-tools/pulls/$pr" > pr.json
head="$(jq -er .head.sha pr.json)"
gh api "repos/aviaratech/ai-plugin-tools/git/commits/$head" > head.json
gh api "repos/aviaratech/ai-plugin-tools/pulls/$pr/reviews?per_page=100" --paginate --slurp | jq 'add' > reviews.json
gh api graphql -f query='query($n:Int!){repository(owner:"aviaratech",name:"ai-plugin-tools"){pullRequest(number:$n){reviewDecision}}}' -F n="$pr" > review-decision.json
jq -e '.errors == null and (.data.repository.pullRequest.reviewDecision | type == "string")' review-decision.json > /dev/null
review="$(jq --arg bot "$REVIEWER_BOT_ID" '[.[] | select((.user.id | tostring) == $bot)] | sort_by(.id) | last | .node_id // error("configured App review absent")' reviews.json -r)"
gh api graphql -f query='query($id:ID!){node(id:$id){...on PullRequestReview{id fullDatabaseId state authorCanPushToRepository author{login} commit{oid} pullRequest{number headRefOid baseRepository{nameWithOwner}}}}}' -f id="$review" > app-review-eligibility.json
jq -e '.errors == null and .data.node != null' app-review-eligibility.json > /dev/null
gh api graphql -f query='query{repository(owner:"aviaratech",name:"ai-plugin-tools"){ref(qualifiedName:"refs/heads/main"){branchProtectionRule{requiresStatusChecks requiresStrictStatusChecks requiredStatusCheckContexts requiresApprovingReviews requiredApprovingReviewCount dismissesStaleReviews isAdminEnforced requiresLinearHistory allowsForcePushes allowsDeletions}}}}' > protection-raw.json
jq -e '.errors == null and (.data.repository.ref.branchProtectionRule | type == "object")' protection-raw.json > /dev/null
jq '.data.repository.ref.branchProtectionRule | {
  required_status_checks:(if .requiresStatusChecks then {strict:.requiresStrictStatusChecks,contexts:.requiredStatusCheckContexts} else null end),
  required_pull_request_reviews:(if .requiresApprovingReviews then {required_approving_review_count:.requiredApprovingReviewCount,dismiss_stale_reviews:.dismissesStaleReviews} else null end),
  enforce_admins:{enabled:.isAdminEnforced},required_linear_history:{enabled:.requiresLinearHistory},
  allow_force_pushes:{enabled:.allowsForcePushes},allow_deletions:{enabled:.allowsDeletions}}' protection-raw.json > protection.json
gh api "repos/aviaratech/ai-plugin-tools/commits/$target/check-runs?per_page=100" --paginate --slurp |
  jq '{check_runs:[.[]|.check_runs[]]}' > checks.json
gh api repos/aviaratech/ai-plugin-tools/issues/1 > issue.json
gh api 'repos/aviaratech/ai-plugin-tools/actions/artifacts?name=publish-intent-0.1.0&per_page=100' --paginate --slurp |
  jq '{intents:[.[]|.artifacts[]]}' > publication-history.json
code="$(curl --silent --show-error --connect-timeout 15 --output package-body.json --write-out '%{http_code}' https://registry.npmjs.org/@aviaratech%2fai-plugin-tools)"
jq --argjson status "$code" '{statusCode:$status,body:.}' package-body.json > package-registry.json
code="$(curl --silent --show-error --connect-timeout 15 --output registry-body.json --write-out '%{http_code}' https://registry.npmjs.org/@aviaratech%2fai-plugin-tools/0.1.0)"
jq --argjson status "$code" '{statusCode:$status,body:.}' registry-body.json > registry.json
