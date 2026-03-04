set -euo pipefail

   BASE_URL="${BASE_URL:-http://localhost:8787}"

   post_json() {
     local path="$1" body="$2"
     curl -sS -X POST "$BASE_URL$path" -H 'content-type: application/json' -d "$body"
   }

   json_field() { # json_field "$json" "requestId"
     local json="$1" field="$2"
     printf '%s' "$json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j['$field'] ?? '')})"
   }

   json_bool() { # json_bool "$json" "matched"
     local json="$1" field="$2"
     printf '%s' "$json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(Boolean(j['$field']))})"
   }

   assert_eq() {
     local got="$1" expected="$2" msg="$3"
     [[ "$got" == "$expected" ]] || { echo "FAIL: $msg (got='$got' expected='$expected')"; exit 1; }
   }

   echo "1) join p1 (expect queued)"
   A="$(post_json /matchmaking/join '{"playerId":"p1"}')"
   echo "$A"
   A_MATCHED="$(json_bool "$A" "matched")"
   A_STATUS="$(json_field "$A" "status")"
   A_REQ_ID="$(json_field "$A" "requestId")"
   assert_eq "$A_MATCHED" "false" "p1 initial join should be unmatched"
   assert_eq "$A_STATUS" "queued" "p1 initial join status"
   [[ -n "$A_REQ_ID" ]] || { echo "FAIL: requestId missing on queued join"; exit 1; }

   echo "2) cancel p1 (expect cancelled)"
   CANCEL="$(post_json /matchmaking/cancel "{\"playerId\":\"p1\",\"requestId\":\"$A_REQ_ID\"}")"
   echo "$CANCEL"
   C_CANCELLED="$(json_bool "$CANCEL" "cancelled")"
   C_STATUS="$(json_field "$CANCEL" "status")"
   assert_eq "$C_CANCELLED" "true" "cancel should succeed"
   assert_eq "$C_STATUS" "cancelled" "cancel status"

   echo "3) join p1 then p2 (expect matched on second)"
   J1="$(post_json /matchmaking/join '{"playerId":"p1"}')"
   J2="$(post_json /matchmaking/join '{"playerId":"p2"}')"
   echo "$J1"
   echo "$J2"
   J2_MATCHED="$(json_bool "$J2" "matched")"
   J2_ROOM="$(json_field "$J2" "roomId")"
   assert_eq "$J2_MATCHED" "true" "second join should match"
   [[ -n "$J2_ROOM" ]] || { echo "FAIL: roomId missing on matched join"; exit 1; }

   echo "4) rematch p1 then p2 on demo-room-1 (expect matched on second)"
   R1="$(post_json /matchmaking/rematch '{"roomId":"demo-room-1","playerId":"p1"}')"
   R2="$(post_json /matchmaking/rematch '{"roomId":"demo-room-1","playerId":"p2"}')"
   echo "$R1"
   echo "$R2"
   R1_MATCHED="$(json_bool "$R1" "matched")"
   R1_STATUS="$(json_field "$R1" "status")"
   R2_MATCHED="$(json_bool "$R2" "matched")"
   R2_ROOM="$(json_field "$R2" "roomId")"
   assert_eq "$R1_MATCHED" "false" "first rematch should wait"
   assert_eq "$R1_STATUS" "waiting_rematch" "first rematch status"
   assert_eq "$R2_MATCHED" "true" "second rematch should match"
   [[ -n "$R2_ROOM" ]] || { echo "FAIL: roomId missing on matched rematch"; exit 1; }

   echo "✅ All matchmaking manual checks passed."
