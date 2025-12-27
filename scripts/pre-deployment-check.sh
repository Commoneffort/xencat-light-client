#!/bin/bash
#
# Pre-Deployment Checklist Script
# Verifies all prerequisites before deploying to X1
#

set -e

echo "╔════════════════════════════════════════════════════╗"
echo "║  PRE-DEPLOYMENT CHECKLIST                         ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

ERRORS=0
WARNINGS=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ERRORS=$((ERRORS + 1))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

echo "1️⃣  Environment Variables"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$SOLANA_RPC" ]; then
    check_pass "SOLANA_RPC set: $SOLANA_RPC"
else
    check_warn "SOLANA_RPC not set (will use default)"
fi

if [ -n "$X1_RPC" ]; then
    check_pass "X1_RPC set: $X1_RPC"
else
    check_warn "X1_RPC not set (will use default from Anchor.toml)"
fi

if [ -n "$ANCHOR_WALLET" ]; then
    check_pass "ANCHOR_WALLET set: $ANCHOR_WALLET"
else
    check_fail "ANCHOR_WALLET not set!"
    echo "   Set with: export ANCHOR_WALLET=~/.config/solana/identity.json"
fi

echo ""
echo "2️⃣  Files & Directories"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "Anchor.toml" ]; then
    check_pass "Anchor.toml exists"
else
    check_fail "Anchor.toml not found!"
fi

if [ -f "target/idl/solana_light_client_x1.json" ]; then
    check_pass "Light client IDL exists"
else
    check_fail "Light client IDL not found! Run: anchor build"
fi

if [ -f "target/idl/xencat_mint_x1.json" ]; then
    check_pass "Mint program IDL exists"
else
    check_fail "Mint program IDL not found! Run: anchor build"
fi

if [ -f "target/deploy/solana_light_client_x1.so" ]; then
    SIZE=$(stat -f%z "target/deploy/solana_light_client_x1.so" 2>/dev/null || stat -c%s "target/deploy/solana_light_client_x1.so" 2>/dev/null)
    check_pass "Light client .so exists (${SIZE} bytes)"
else
    check_fail "Light client .so not found! Run: anchor build"
fi

if [ -f "target/deploy/xencat_mint_x1.so" ]; then
    SIZE=$(stat -f%z "target/deploy/xencat_mint_x1.so" 2>/dev/null || stat -c%s "target/deploy/xencat_mint_x1.so" 2>/dev/null)
    check_pass "Mint program .so exists (${SIZE} bytes)"
else
    check_fail "Mint program .so not found! Run: anchor build"
fi

echo ""
echo "3️⃣  Dev-Mode Feature Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if grep -q "default = \[\"dev-mode\"\]" programs/solana-light-client-x1/Cargo.toml; then
    check_fail "CRITICAL: dev-mode is in default features!"
    echo "   This will allow mock signatures in production!"
    echo "   Remove 'dev-mode' from default features in Cargo.toml"
elif grep -q "dev-mode = \[\]" programs/solana-light-client-x1/Cargo.toml; then
    check_pass "dev-mode feature exists but not in default (OK)"
else
    check_pass "No dev-mode feature found"
fi

echo ""
echo "4️⃣  Build Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -n "Checking latest build timestamp... "
CARGO_TOML_TIME=$(stat -f%m programs/solana-light-client-x1/Cargo.toml 2>/dev/null || stat -c%Y programs/solana-light-client-x1/Cargo.toml 2>/dev/null)
SO_TIME=$(stat -f%m target/deploy/solana_light_client_x1.so 2>/dev/null || stat -c%Y target/deploy/solana_light_client_x1.so 2>/dev/null)

if [ "$SO_TIME" -gt "$CARGO_TOML_TIME" ]; then
    check_pass "Build is up to date"
else
    check_warn "Build may be outdated. Run: anchor build"
fi

echo ""
echo "5️⃣  Validator Data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "top-7-validators.json" ]; then
    check_pass "Validator data file exists"

    # Check validator count
    COUNT=$(cat top-7-validators.json | grep -o '"validatorCount":[0-9]*' | grep -o '[0-9]*')
    if [ "$COUNT" = "7" ]; then
        check_pass "Validator count: 7"
    else
        check_warn "Validator count: $COUNT (expected 7)"
    fi

    # Check stake percentage (requires jq)
    if command -v jq &> /dev/null; then
        STAKE=$(cat top-7-validators.json | jq -r '.stakePercentage')
        STAKE_INT=${STAKE%.*}
        if [ "$STAKE_INT" -ge 15 ]; then
            check_pass "Stake percentage: ${STAKE}% (>= 15%)"
        else
            check_fail "Stake percentage: ${STAKE}% (< 15% minimum!)"
        fi
    else
        check_warn "jq not installed, skipping stake check"
    fi

    # Check age
    TIMESTAMP=$(cat top-7-validators.json | grep -o '"timestamp":[0-9]*' | grep -o '[0-9]*')
    NOW=$(date +%s)
    AGE=$((NOW - TIMESTAMP / 1000))
    AGE_HOURS=$((AGE / 3600))

    if [ "$AGE_HOURS" -lt 24 ]; then
        check_pass "Validator data age: ${AGE_HOURS} hours (fresh)"
    else
        check_warn "Validator data age: ${AGE_HOURS} hours (consider refreshing)"
    fi
else
    check_fail "Validator data not found!"
    echo "   Run: ts-node scripts/fetch-top-validators.ts 7"
fi

echo ""
echo "6️⃣  Network Connectivity"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -n "Testing Solana RPC... "
if curl -s -m 5 "${SOLANA_RPC:-https://api.mainnet-beta.solana.com}" > /dev/null; then
    check_pass "Solana RPC reachable"
else
    check_fail "Solana RPC unreachable!"
fi

echo -n "Testing X1 RPC... "
X1_URL="${X1_RPC:-https://rpc.testnet.x1.xyz}"
if curl -s -m 5 "$X1_URL" > /dev/null; then
    check_pass "X1 RPC reachable: $X1_URL"
else
    check_fail "X1 RPC unreachable: $X1_URL"
fi

echo ""
echo "7️⃣  Wallet Balance (if wallet configured)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$ANCHOR_WALLET" ] && [ -f "$ANCHOR_WALLET" ]; then
    BALANCE=$(solana balance --url "$X1_URL" 2>/dev/null | grep -o '[0-9.]*' | head -1)

    if [ -n "$BALANCE" ]; then
        BALANCE_INT=${BALANCE%.*}
        if [ "$BALANCE_INT" -ge 10 ]; then
            check_pass "X1 balance: ${BALANCE} XNT (>= 10 XNT)"
        else
            check_warn "X1 balance: ${BALANCE} XNT (< 10 XNT recommended)"
            echo "   Get testnet XNT: https://faucet.testnet.x1.xyz"
        fi
    else
        check_warn "Could not check X1 balance"
    fi
else
    check_warn "Wallet not configured, skipping balance check"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Ready for deployment.${NC}"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Warnings: $WARNINGS${NC}"
    echo "  You can proceed with caution."
    echo ""
    exit 0
else
    echo -e "${RED}✗ Errors: $ERRORS${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠ Warnings: $WARNINGS${NC}"
    fi
    echo ""
    echo "Please fix errors before deploying."
    echo ""
    exit 1
fi
