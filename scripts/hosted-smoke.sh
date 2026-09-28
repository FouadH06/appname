#!/usr/bin/env bash
# Hosted smoke test through the public Data API, exactly as a browser with the anon key sees it.
# Usage: SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> scripts/hosted-smoke.sh
# Uses only the public (anon/publishable) key. Never pass the service-role key here.
set -uo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
REST="$SUPABASE_URL/rest/v1"
H=(-H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY")
pass=0; fail=0

check() { # name, expected (regex on "<status> <body>"), curl args...
  local name="$1" expected="$2"; shift 2
  local out status body
  out="$(curl -s -m 30 -w $'\n%{http_code}' "${H[@]}" "$@")"
  status="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [[ "$status $body" =~ $expected ]]; then
    echo "PASS  $name  ($status)"; pass=$((pass + 1))
  else
    echo "FAIL  $name  → $status ${body:0:200}"; fail=$((fail + 1))
  fi
}

echo "== Intended public reads (catalog reference data) =="
check "anon reads active canonical services" '^200 \[\{"slug":'          "$REST/canonical_services?select=slug&is_active=eq.true&limit=3"
check "anon reads live clusters"             '^200 \[\{'                 "$REST/clusters?select=slug&is_live=eq.true"
check "anon reads synonyms"                  '^200 \[\{'                 "$REST/service_synonyms?select=term&limit=3"
check "hidden category not visible"          '^200 \[\]$'                "$REST/categories?select=slug&slug=eq.aesthetics"

echo "== Default deny =="
check "profiles blocked for anon"            '^40[13] '                  "$REST/profiles?select=id&limit=1"
check "admin_users blocked for anon"         '^40[13] '                  "$REST/admin_users?select=user_id&limit=1"
check "catalog insert blocked for anon"      '^40[13] '                  -X POST -H "Content-Type: application/json" \
                                                                         -d '{"term":"x","lang":"en","canonical_service_id":"00000000-0000-0000-0000-000000000000"}' \
                                                                         "$REST/service_synonyms"
check "catalog update blocked for anon"      '^40[13] '                  -X PATCH -H "Content-Type: application/json" \
                                                                         -d '{"name_en":"hacked"}' "$REST/canonical_services?slug=eq.balayage"
check "private schema not exposed (RPC)"     '^(404|406) '               -X POST -H "Content-Type: application/json" \
                                                                         -d '{"p_raw":"03123456"}' "$REST/rpc/normalize_phone"
check "private schema not exposed (profile)" '^406 '                     -H "Accept-Profile: private" "$REST/rate_limits?select=*"
check "audit schema not exposed"             '^406 '                     -H "Accept-Profile: audit" "$REST/entity_changes?select=*"

echo "== M4 identity: logged-out callers =="
post() { check "$1" "$2" -X POST -H "Content-Type: application/json" -d "$3" "$REST/rpc/$4"; }
post "claim link with unknown token → TOKEN_INVALID"   '^400 .*TOKEN_INVALID'  '{"p_token":"nope"}' resolve_access_token
post "invite link with unknown token → INVITE_INVALID" '^400 .*INVITE_INVALID' '{"p_token":"nope"}' get_invitation
post "anon cannot claim a visit"          '^40[13] ' '{"p_token":"nope"}' claim_booking
post "anon cannot list claimable visits"  '^40[13] ' '{}'                 get_claimable_visits
post "anon cannot accept an invitation"   '^40[13] ' '{"p_token":"nope"}' accept_invitation
post "anon cannot invite members"         '^40[13] ' '{"p_business_id":"00000000-0000-0000-0000-000000000000","p_phone":"70123456","p_role":"staff"}' invite_member
post "anon cannot read an access summary" '^40[13] ' '{}'                 get_my_access
post "anon cannot delete an account"      '^40[13] ' '{}'                 delete_my_account
post "anon cannot route OTPs (hook-only)" '^40[13] ' '{"p_phone":"96170123456"}' otp_route
post "anon cannot write OTP receipts"     '^40[13] ' '{"p_provider":"twilio","p_message_id":"x","p_status":"delivered"}' otp_status_update
post "anon cannot read OTP stats"         '^40[13] ' '{}'                 admin_otp_delivery_stats

echo "== Result: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
