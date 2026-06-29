#!/usr/bin/env bash
#
# try-endpoints.sh — a guided walk through the Secret Santa API.
#
# Start the service first (in another terminal):
#
#     npm run dev          # http://localhost:3000
#
# then run this script:
#
#     ./scripts/try-endpoints.sh
#
# It exercises the happy path (create → draw → history → idempotent re-draw)
# and the documented error cases (404 / 400 / 422). Override the target with
# BASE, e.g.  BASE=http://localhost:8080 ./scripts/try-endpoints.sh
#
set -uo pipefail

BASE=${BASE:-http://localhost:3000}

# --- pretty output ------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'
  CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; GREEN=''; RED=''; CYAN=''; RESET=''
fi

step() { printf '\n%s━━ %s %s\n' "$BOLD" "$1" "$RESET"; }
note() { printf '%s   %s%s\n' "$DIM" "$1" "$RESET"; }

# Pretty-print a JSON string (falls back to raw if python3 is absent).
pretty() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -m json.tool 2>/dev/null | sed 's/^/    /' \
      || printf '    %s\n' "$1"
  else
    printf '    %s\n' "$1"
  fi
}

# Extract a top-level string field from a JSON object.
json_field() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c "import sys,json;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null
  else
    printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
  fi
}

LAST_BODY=''
LAST_STATUS=''

# call METHOD PATH [JSON_BODY] [EXPECTED_STATUS]
# Performs the request, prints status + body, and (if EXPECTED given) asserts it.
call() {
  local method=$1 path=$2 body=${3:-} expected=${4:-}
  local args=(-s -X "$method" "$BASE$path" -H 'content-type: application/json')
  [[ -n $body ]] && args+=(-d "$body")

  printf '%s   %s %s%s\n' "$CYAN" "$method" "$path" "$RESET"
  [[ -n $body ]] && note "↳ $body"

  local resp
  resp=$(curl "${args[@]}" -w $'\n%{http_code}')
  LAST_STATUS=${resp##*$'\n'}
  LAST_BODY=${resp%$'\n'*}

  local mark="$GREEN✓$RESET"
  if [[ -n $expected && $LAST_STATUS != "$expected" ]]; then
    mark="${RED}✗ expected $expected$RESET"
    FAILURES=$((FAILURES + 1))
  fi
  printf '   → HTTP %s %s\n' "$LAST_STATUS" "$mark"
  pretty "$LAST_BODY"
}

# verify_no_immediate_family FAMILY_JSON DRAW_JSON
# Asserts the draw never makes anyone the Secret Santa for a spouse/parent/child (in
# either direction) or for themselves. Needs python3; skipped gracefully without it.
verify_no_immediate_family() {
  if ! command -v python3 >/dev/null 2>&1; then
    note "python3 not available — skipping assignment content check"
    return
  fi
  local out
  out=$(FAMILY="$1" DRAW="$2" python3 - <<'PY'
import json, os, sys

fam = json.loads(os.environ["FAMILY"])
draw = json.loads(os.environ["DRAW"])
names = {m["id"]: m["name"] for m in fam["members"]}
# Every relationship is symmetric for gifting purposes (spouse/parent/child).
forbidden = {frozenset((r["from"], r["to"])) for r in fam.get("relationships", [])}

violations = []
for a in draw["assignments"]:
    g, r = a["giverId"], a["receiverId"]
    if g == r:
        violations.append(f"{names.get(g, g)} → self")
    elif frozenset((g, r)) in forbidden:
        violations.append(f"{names.get(g, g)} → {names.get(r, r)} (immediate family)")

if violations:
    print("VIOLATIONS: " + "; ".join(violations))
    sys.exit(1)
print(", ".join(f"{names[a['giverId']]}→{names[a['receiverId']]}" for a in draw["assignments"]))
PY
)
  if [[ $? -eq 0 ]]; then
    note "✓ no one is Santa for immediate family: $out"
  else
    note "✗ $out"
    FAILURES=$((FAILURES + 1))
  fi
}

FAILURES=0

# --- preflight ----------------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

if ! curl -s -o /dev/null --max-time 2 "$BASE/health"; then
  printf '%sCannot reach %s%s\n' "$RED" "$BASE" "$RESET" >&2
  printf 'Start the service first:  %snpm run dev%s\n' "$BOLD" "$RESET" >&2
  exit 1
fi

printf '%sSecret Santa API walkthrough%s  →  %s\n' "$BOLD" "$RESET" "$BASE"

# --- 1. liveness / readiness --------------------------------------------------
step "1. Health & readiness probes"
call GET /health '' 200
call GET /ready  '' 200

# --- 2. create a family -------------------------------------------------------
step "2. Create a family (Alice & Bob are spouses)"
note "relationships reference members by array index"
read -r -d '' FAMILY_JSON <<'JSON'
{
  "name": "Magorians",
  "members": [{"name":"Alice"},{"name":"Bob"},{"name":"Carol"},{"name":"Dave"}],
  "relationships": [{"fromIndex":0,"toIndex":1,"type":"spouse"}]
}
JSON
call POST /families "$FAMILY_JSON" 201
FAMILY_ID=$(json_field "$LAST_BODY" id)
MAGORIANS_BODY=$LAST_BODY
note "FAMILY_ID=$FAMILY_ID"

# --- 3. fetch it back ---------------------------------------------------------
step "3. Fetch the family"
call GET "/families/$FAMILY_ID" '' 200

# --- 4. draw for 2026 ---------------------------------------------------------
step "4. Draw Secret Santas for 2026 (seed makes it reproducible)"
call POST "/families/$FAMILY_ID/exchanges" '{"year":2026,"seed":7}' 201
DRAWN_AT=$(json_field "$LAST_BODY" drawnAt)

# --- 5. history ---------------------------------------------------------------
step "5. Read the history (append-only log)"
call GET "/families/$FAMILY_ID/exchanges" '' 200

# --- 6. idempotent re-draw ----------------------------------------------------
step "6. Re-draw 2026 — idempotent: returns the SAME result with 200, no re-notify"
call POST "/families/$FAMILY_ID/exchanges" '{"year":2026,"seed":7}' 200
DRAWN_AT_2=$(json_field "$LAST_BODY" drawnAt)
if [[ -n $DRAWN_AT && $DRAWN_AT == "$DRAWN_AT_2" ]]; then
  note "✓ drawnAt unchanged ($DRAWN_AT) — it was not re-drawn"
else
  note "✗ drawnAt changed — expected the original draw"
  FAILURES=$((FAILURES + 1))
fi

# --- 7. another year ----------------------------------------------------------
step "7. Draw a second year (2027) — new entry, 201"
call POST "/families/$FAMILY_ID/exchanges" '{"year":2027,"seed":7}' 201

step "   History now holds both years"
call GET "/families/$FAMILY_ID/exchanges" '' 200

# --- 8. immediate family with children (Part 3) -------------------------------
step "8. Immediate family with children — nobody is Santa for a spouse, parent, or child"
note "Mom & Dad are spouses and parents of Kid1 & Kid2; Aunt & Uncle are another couple"
read -r -d '' KIDS_JSON <<'JSON'
{
  "name": "Three Generations",
  "members": [
    {"name":"Mom"},{"name":"Dad"},{"name":"Kid1"},{"name":"Kid2"},{"name":"Aunt"},{"name":"Uncle"}
  ],
  "relationships": [
    {"fromIndex":0,"toIndex":1,"type":"spouse"},
    {"fromIndex":0,"toIndex":2,"type":"child"},
    {"fromIndex":0,"toIndex":3,"type":"child"},
    {"fromIndex":1,"toIndex":2,"type":"child"},
    {"fromIndex":1,"toIndex":3,"type":"child"},
    {"fromIndex":4,"toIndex":5,"type":"spouse"}
  ]
}
JSON
call POST /families "$KIDS_JSON" 201
KIDS_FAMILY_BODY=$LAST_BODY
KIDS_ID=$(json_field "$LAST_BODY" id)

call POST "/families/$KIDS_ID/exchanges" '{"year":2026,"seed":3}' 201
verify_no_immediate_family "$KIDS_FAMILY_BODY" "$LAST_BODY"

# --- 9. wider/extended family (grandparents, aunts/uncles, cousins) -----------
step "9. Extended family across three generations — only immediate family is excluded"
note "Grandparents → 2 married children → grandchildren (cousins); only spouse/parent/child are off-limits"
read -r -d '' EXTENDED_JSON <<'JSON'
{
  "name": "Three-Generation Clan",
  "members": [
    {"name":"Grandpa"},{"name":"Grandma"},
    {"name":"Alice"},{"name":"Andy"},{"name":"Bob"},{"name":"Beth"},
    {"name":"Carol"},{"name":"Dan"}
  ],
  "relationships": [
    {"fromIndex":0,"toIndex":1,"type":"spouse"},
    {"fromIndex":0,"toIndex":2,"type":"child"},
    {"fromIndex":1,"toIndex":2,"type":"child"},
    {"fromIndex":0,"toIndex":4,"type":"child"},
    {"fromIndex":1,"toIndex":4,"type":"child"},
    {"fromIndex":2,"toIndex":3,"type":"spouse"},
    {"fromIndex":4,"toIndex":5,"type":"spouse"},
    {"fromIndex":2,"toIndex":6,"type":"child"},
    {"fromIndex":3,"toIndex":6,"type":"child"},
    {"fromIndex":4,"toIndex":7,"type":"child"},
    {"fromIndex":5,"toIndex":7,"type":"child"}
  ]
}
JSON
call POST /families "$EXTENDED_JSON" 201
EXTENDED_FAMILY_BODY=$LAST_BODY
EXTENDED_ID=$(json_field "$LAST_BODY" id)

call POST "/families/$EXTENDED_ID/exchanges" '{"year":2026,"seed":7}' 201
verify_no_immediate_family "$EXTENDED_FAMILY_BODY" "$LAST_BODY"
note "cousins, grandparent→grandchild, aunt/uncle→niece/nephew pairings are all allowed"

# --- 10. per-person incremental draw ------------------------------------------
step "10. Per-person draw — each member draws their own name (any order, no dead-ends)"
read -r -d '' PP_JSON <<'JSON'
{
  "name": "Hat Drawers",
  "members": [{"name":"Ada"},{"name":"Ben"},{"name":"Cleo"},{"name":"Dex"}]
}
JSON
call POST /families "$PP_JSON" 201
PP_BODY=$LAST_BODY
PP_ID=$(json_field "$LAST_BODY" id)

if command -v python3 >/dev/null 2>&1; then
  for MID in $(printf '%s' "$PP_BODY" | python3 -c "import sys,json;[print(m['id']) for m in json.load(sys.stdin)['members']]"); do
    call POST "/families/$PP_ID/members/$MID/draws" '{"year":2026}' 201
  done

  step "   The individual draws assemble into one complete, valid exchange"
  call GET "/families/$PP_ID/exchanges" '' 200
  verify_no_immediate_family "$PP_BODY" \
    "$(printf '%s' "$LAST_BODY" | python3 -c "import sys,json;print(json.dumps(json.load(sys.stdin)[0]))")"
else
  note "python3 not available — skipping the per-member draw loop"
fi

# --- 11. three generations, drawn one person at a time ------------------------
step "11. Three generations, per-person — the same clan draws a new year (2027) one at a time"
note "reuses the step 9 clan; respects last year's draw and immediate-family rules"
if command -v python3 >/dev/null 2>&1; then
  for MID in $(printf '%s' "$EXTENDED_FAMILY_BODY" | python3 -c "import sys,json;[print(m['id']) for m in json.load(sys.stdin)['members']]"); do
    call POST "/families/$EXTENDED_ID/members/$MID/draws" '{"year":2027}' 201
  done

  step "   Eight individual draws assemble into one complete, valid 2027 exchange"
  call GET "/families/$EXTENDED_ID/exchanges" '' 200
  verify_no_immediate_family "$EXTENDED_FAMILY_BODY" \
    "$(printf '%s' "$LAST_BODY" | python3 -c "import sys,json;print(json.dumps(next(e for e in json.load(sys.stdin) if e['year']==2027)))")"
else
  note "python3 not available — skipping the per-member draw loop"
fi

# --- 12. read a member's own draw ---------------------------------------------
step "12. Ask \"who did I draw?\" — only the member's own receiver is revealed"
note "reuses the Magorians family, which drew 2026 and 2027 above"
if command -v python3 >/dev/null 2>&1; then
  MEMBER_ID=$(printf '%s' "$MAGORIANS_BODY" | python3 -c "import sys,json;print(json.load(sys.stdin)['members'][0]['id'])")
  MEMBER_NAME=$(printf '%s' "$MAGORIANS_BODY" | python3 -c "import sys,json;print(json.load(sys.stdin)['members'][0]['name'])")
  note "$MEMBER_NAME ($MEMBER_ID)"

  note "a) one year → just this member's receiver, not the whole mapping (200)"
  call GET "/families/$FAMILY_ID/members/$MEMBER_ID/draws?year=2026" '' 200

  note "b) no year → the member's whole draw history, oldest first (200)"
  call GET "/families/$FAMILY_ID/members/$MEMBER_ID/draws" '' 200

  note "c) a year they haven't drawn → 404 DRAW_NOT_FOUND"
  call GET "/families/$FAMILY_ID/members/$MEMBER_ID/draws?year=1999" '' 404
else
  note "python3 not available — skipping (needs a member id from the family body)"
fi

# --- 13. error cases ----------------------------------------------------------
step "13. Error cases (stable { code, message } shape)"

note "a) unknown family → 404 FAMILY_NOT_FOUND"
call GET "/families/does-not-exist" '' 404

note "b) invalid body (only one member) → 400 VALIDATION_ERROR"
call POST /families '{"name":"Solo","members":[{"name":"Onlyone"}]}' 400

note "c) over-constrained family (two spouses, nobody left to gift) → 422 NO_VALID_ASSIGNMENT"
call POST /families '{"name":"Pair","members":[{"name":"X"},{"name":"Y"}],"relationships":[{"fromIndex":0,"toIndex":1,"type":"spouse"}]}' 201
PAIR_ID=$(json_field "$LAST_BODY" id)
call POST "/families/$PAIR_ID/exchanges" '{"year":2026}' 422

# --- summary ------------------------------------------------------------------
step "Done"
if [[ $FAILURES -eq 0 ]]; then
  printf '%sAll checks passed.%s\n' "$GREEN" "$RESET"
  exit 0
else
  printf '%s%d check(s) did not match the expected status.%s\n' "$RED" "$FAILURES" "$RESET"
  exit 1
fi
