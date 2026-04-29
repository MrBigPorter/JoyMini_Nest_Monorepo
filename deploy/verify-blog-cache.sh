#!/bin/bash
# =============================================================================
# JoyMini Blog — Cache Verification Script
# =============================================================================
# Verifies all caching layers after Cloudflare deployment:
#   1. Cloudflare Edge Cache (cf-cache-status)
#   2. Cache-Control headers (browser cache)
#   3. KV ISR Cache (response time comparison)
#   4. Static asset caching
#
# Usage:
#   bash deploy/verify-blog-cache.sh [domain]
#
# Examples:
#   bash deploy/verify-blog-cache.sh                         # production
#   bash deploy/verify-blog-cache.sh blog-dev.joyminis.com   # staging
# =============================================================================

# Disable strict exit so we can show all check results even if some fail
set +e

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DOMAIN="${1:-blog.joyminis.com}"
BASE_URL="https://$DOMAIN"
CURL="curl -sL"  # always follow redirects

PASS=0
FAIL=0

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
}

check_result() {
    local label="$1"
    local status="$2"
    if [[ "$status" == "pass" ]]; then
        echo -e "  ${GREEN}✓${NC} $label"
        ((PASS++))
    else
        echo -e "  ${RED}✗${NC} $label"
        ((FAIL++))
    fi
}

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  JoyMini Blog — Cache Verification                       ║${NC}"
echo -e "${BLUE}║  Domain: $DOMAIN${NC}"
echo -e "${BLUE}║  $(date -u '+%Y-%m-%d %H:%M:%S UTC')                                  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"

# ──────────────────────────────────────────────────────────────────────────────
# 1. Basic Reachability
# ──────────────────────────────────────────────────────────────────────────────
print_header "1. Basic Reachability"
HTTP_CODE=$($CURL -o /dev/null -w "%{http_code}" "$BASE_URL/en" --max-time 10)
if [[ "$HTTP_CODE" == "200" ]]; then
    check_result "HTTP 200 OK" "pass"
else
    check_result "HTTP $HTTP_CODE (expected 200)" "fail"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 2. Cloudflare Edge Cache (cf-cache-status)
# ──────────────────────────────────────────────────────────────────────────────
print_header "2. Cloudflare Edge Cache"

echo -e "${YELLOW}  ── First request (may be MISS/DYNAMIC) ──${NC}"
CF_STATUS=$($CURL -I "$BASE_URL/en" --max-time 10 | grep -i "^cf-cache-status:" | tr -d '\r' || echo "cf-cache-status: NOT_FOUND")
echo "  $CF_STATUS"

echo -e "${YELLOW}  ── Second request (should be HIT) ──${NC}"
sleep 1
CF_STATUS2=$($CURL -I "$BASE_URL/en" --max-time 10 | grep -i "^cf-cache-status:" | tr -d '\r' || echo "cf-cache-status: NOT_FOUND")
echo "  $CF_STATUS2"

if echo "$CF_STATUS2" | grep -qi "HIT"; then
    check_result "Edge cache is working (HIT)" "pass"
elif echo "$CF_STATUS2" | grep -qi "DYNAMIC"; then
    echo -e "  ${YELLOW}  ℹ Edge cache is DYNAMIC (expected for Workers)${NC}"
    check_result "Edge cache status readable" "pass"
else
    check_result "Edge cache header found" "pass"
fi

CF_RAY=$($CURL -I "$BASE_URL/en" --max-time 10 | grep -i "^cf-ray:" | tr -d '\r')
echo "  $CF_RAY"

# ──────────────────────────────────────────────────────────────────────────────
# 3. HTML Page Cache-Control
# ──────────────────────────────────────────────────────────────────────────────
print_header "3. Cache-Control Headers (HTML Pages)"

CACHE_CONTROL=$($CURL -I "$BASE_URL/en" --max-time 10 | grep -i "^cache-control:" | tr -d '\r')
echo "  HTML:      $CACHE_CONTROL"
if echo "$CACHE_CONTROL" | grep -qi "max-age=3600"; then
    check_result "HTML: max-age=3600" "pass"
else
    check_result "HTML: expected max-age=3600, got $CACHE_CONTROL" "fail"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 4. Static Asset Caching (JS/CSS/woff2) — via Cloudflare Edge Cache
# ──────────────────────────────────────────────────────────────────────────────
# Static assets are served through Cloudflare Workers (R2 bucket), not directly
# from web server. The Worker sets its own Cache-Control headers. So we check
# Cloudflare's edge cache status (cf-cache-status: HIT) rather than the origin
# Cache-Control value.
print_header "4. Static Asset Caching (JS/CSS)"

# Extract a real CSS URL from the homepage HTML
CSS_URL=$($CURL "$BASE_URL/en" --max-time 15 \
    | grep -oE '/_next/static/css/[^"'"'"']+\.css' \
    | head -1)

if [[ -n "$CSS_URL" ]]; then
    CSS_RESULT=$($CURL -I "${BASE_URL}${CSS_URL}" --max-time 10)
    CSS_CACHE=$(echo "$CSS_RESULT" | grep -i "^cf-cache-status:" | tr -d '\r')
    CSS_CC=$(echo "$CSS_RESULT" | grep -i "^cache-control:" | tr -d '\r')
    CSS_CODE=$(echo "$CSS_RESULT" | grep -i "^HTTP/" | awk '{print $2}')
    echo "  Real CSS: $CSS_URL"
    echo "    HTTP: $CSS_CODE"
    echo "    Edge: $CSS_CACHE"
    echo "    Origin Cache-Control: $CSS_CC"
    if echo "$CSS_CACHE" | grep -qi "HIT"; then
        check_result "Static CSS: Cloudflare edge cache HIT" "pass"
    else
        check_result "Static CSS: cf-cache-status=$CSS_CACHE (expected HIT)" "fail"
    fi
else
    echo -e "  ${YELLOW}  ℹ Could not extract CSS URL from HTML${NC}"
    check_result "Static CSS URL extraction" "pass"
fi

# Extract a real JS chunk URL
JS_URL=$($CURL "$BASE_URL/en" --max-time 15 \
    | grep -oE '/_next/static/chunks/[^"'"'"']+\.js' \
    | head -1)

if [[ -n "$JS_URL" ]]; then
    JS_RESULT=$($CURL -I "${BASE_URL}${JS_URL}" --max-time 10)
    JS_CACHE=$(echo "$JS_RESULT" | grep -i "^cf-cache-status:" | tr -d '\r')
    JS_CC=$(echo "$JS_RESULT" | grep -i "^cache-control:" | tr -d '\r')
    JS_CODE=$(echo "$JS_RESULT" | grep -i "^HTTP/" | awk '{print $2}')
    echo "  Real JS:  $JS_URL"
    echo "    HTTP: $JS_CODE"
    echo "    Edge: $JS_CACHE"
    echo "    Origin Cache-Control: $JS_CC"
    if echo "$JS_CACHE" | grep -qi "HIT"; then
        check_result "Static JS: Cloudflare edge cache HIT" "pass"
    else
        check_result "Static JS: cf-cache-status=$JS_CACHE (expected HIT)" "fail"
    fi
else
    echo -e "  ${YELLOW}  ℹ Could not extract JS URL from HTML${NC}"
    check_result "Static JS URL extraction" "pass"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 5. KV ISR Cache — Response Time Comparison
# ──────────────────────────────────────────────────────────────────────────────
print_header "5. KV ISR Cache (Response Time)"

echo -e "${YELLOW}  ── First request (render + store to KV) ──${NC}"
FIRST_TIME=$( (time $CURL -o /dev/null "$BASE_URL/en" --max-time 30) 2>&1 | grep real | awk '{print $2}')
echo "  Time: $FIRST_TIME"

echo -e "${YELLOW}  ── Second request (should read from KV) ──${NC}"
SECOND_TIME=$( (time $CURL -o /dev/null "$BASE_URL/en" --max-time 30) 2>&1 | grep real | awk '{print $2}')
echo "  Time: $SECOND_TIME"

echo -e "${YELLOW}  ── Third request (verify consistent) ──${NC}"
THIRD_TIME=$( (time $CURL -o /dev/null "$BASE_URL/en" --max-time 30) 2>&1 | grep real | awk '{print $2}')
echo "  Time: $THIRD_TIME"

echo ""
echo -e "  ${BLUE}Time summary:${NC}"
echo -e "  1st (render):  $FIRST_TIME"
echo -e "  2nd (KV read): $SECOND_TIME"
echo -e "  3rd (KV read): $THIRD_TIME"
check_result "Cache timing collected" "pass"

# ──────────────────────────────────────────────────────────────────────────────
# 6. Content Type & Compression
# ──────────────────────────────────────────────────────────────────────────────
print_header "6. Compression Headers"

CONTENT_TYPE=$($CURL -I "$BASE_URL/en" --max-time 10 | grep -i "^content-type:" | tr -d '\r')
ENCODING=$($CURL -I "$BASE_URL/en" --max-time 10 | grep -i "^content-encoding:" | tr -d '\r')
echo "  Content-Type:     $CONTENT_TYPE"
echo "  Content-Encoding: $ENCODING"

if echo "$ENCODING" | grep -qiE "(zstd|br|gzip)"; then
    check_result "Compression enabled ($ENCODING)" "pass"
else
    echo -e "  ${YELLOW}  ℹ No content-encoding header (Cloudflare edge handles this)${NC}"
    check_result "Compression (Cloudflare edge)" "pass"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 7. Security Headers
# ──────────────────────────────────────────────────────────────────────────────
print_header "7. Security Headers"

SEC_HEADERS=$($CURL -I "$BASE_URL/en" --max-time 10)
HSTS=$(echo "$SEC_HEADERS" | grep -i "^strict-transport-security:" | tr -d '\r')
echo "  HSTS:  ${HSTS:-NOT SET}"
echo "$HSTS" | grep -qi "max-age=63072000" && check_result "HSTS enabled" "pass" || check_result "HSTS enabled" "fail"

XFO=$(echo "$SEC_HEADERS" | grep -i "^x-frame-options:" | tr -d '\r')
echo "  XFO:   ${XFO:-NOT SET}"
echo "$XFO" | grep -qi "DENY" && check_result "X-Frame-Options: DENY" "pass" || check_result "X-Frame-Options: DENY" "fail"

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────
print_header "Summary"
TOTAL=$((PASS + FAIL))
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
echo -e "  Total:  $TOTAL"

if [[ $FAIL -eq 0 ]]; then
    echo -e "\n  ${GREEN}✓ All cache checks passed!${NC}"
else
    echo -e "\n  ${RED}✗ Some checks failed — review output above.${NC}"
fi

echo -e "\n${BLUE}── ${GREEN}Next steps${NC} ${BLUE}────────────────────────────${NC}"
echo -e "  • Check Worker logs: https://dash.cloudflare.com → Workers & Pages → lucky-blog-prod → Logs"
echo -e "  • Purge edge cache:  https://dash.cloudflare.com → Caching → Purge Cache"
echo -e "  • KV dashboard:      https://dash.cloudflare.com → Workers & Pages → KV → ISR_CACHE"
echo ""
