#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════╗"
echo "║   XENCAT Light Client - X1 Testnet Deployment         ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
RPC_URL="https://rpc.testnet.x1.xyz"
DEPLOYER_KEYPAIR="$HOME/.config/solana/identity.json"

echo "Configuration:"
echo "  RPC URL: $RPC_URL"
echo "  Deployer: $(solana address -k $DEPLOYER_KEYPAIR)"
echo "  Balance: $(solana balance -k $DEPLOYER_KEYPAIR)"
echo ""

# Check if we have enough balance
BALANCE=$(solana balance -k $DEPLOYER_KEYPAIR | awk '{print $1}')
if (( $(echo "$BALANCE < 10" | bc -l) )); then
    echo -e "${RED}ERROR: Insufficient balance. Need at least 10 XNT for deployment${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Balance sufficient${NC}"
echo ""

# Step 1: Build programs
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Building programs..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}ERROR: Anchor CLI not found. Please install Anchor:${NC}"
    echo "  curl -sSf https://install.anchor-lang.com | sh"
    echo "  Or visit: https://www.anchor-lang.com/docs/installation"
    exit 1
fi

cd "$(dirname "$0")/.."
anchor build

echo -e "${GREEN}✓ Programs built successfully${NC}"
echo ""

# Step 2: Generate program keypairs (if they don't exist)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Generating program keypairs..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "target/deploy/solana_light_client_x1-keypair.json" ]; then
    solana-keygen new --no-bip39-passphrase -o target/deploy/solana_light_client_x1-keypair.json
    echo -e "${GREEN}✓ Generated light client keypair${NC}"
else
    echo -e "${YELLOW}! Using existing light client keypair${NC}"
fi

if [ ! -f "target/deploy/xencat_mint_x1-keypair.json" ]; then
    solana-keygen new --no-bip39-passphrase -o target/deploy/xencat_mint_x1-keypair.json
    echo -e "${GREEN}✓ Generated mint program keypair${NC}"
else
    echo -e "${YELLOW}! Using existing mint program keypair${NC}"
fi

LIGHT_CLIENT_ID=$(solana address -k target/deploy/solana_light_client_x1-keypair.json)
MINT_PROGRAM_ID=$(solana address -k target/deploy/xencat_mint_x1-keypair.json)

echo ""
echo "Program IDs:"
echo "  Light Client: $LIGHT_CLIENT_ID"
echo "  Mint Program: $MINT_PROGRAM_ID"
echo ""

# Step 3: Deploy Light Client
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Deploying Light Client..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

solana program deploy \
    --url $RPC_URL \
    --keypair $DEPLOYER_KEYPAIR \
    --program-id target/deploy/solana_light_client_x1-keypair.json \
    target/deploy/solana_light_client_x1.so

echo -e "${GREEN}✓ Light client deployed to: $LIGHT_CLIENT_ID${NC}"
echo ""

# Step 4: Deploy Mint Program
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4: Deploying Mint Program..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

solana program deploy \
    --url $RPC_URL \
    --keypair $DEPLOYER_KEYPAIR \
    --program-id target/deploy/xencat_mint_x1-keypair.json \
    target/deploy/xencat_mint_x1.so

echo -e "${GREEN}✓ Mint program deployed to: $MINT_PROGRAM_ID${NC}"
echo ""

# Step 5: Update lib.rs with actual program IDs
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5: Updating program IDs in source code..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "NOTE: Update the declare_id! in the following files:"
echo "  programs/solana-light-client-x1/src/lib.rs: declare_id!(\"$LIGHT_CLIENT_ID\");"
echo "  programs/xencat-mint-x1/src/lib.rs: declare_id!(\"$MINT_PROGRAM_ID\");"
echo "  Anchor.toml: Update program IDs in [programs.testnet] section"
echo ""

# Save deployment info
cat > deployment-info.json << EOF
{
  "network": "x1-testnet",
  "rpc_url": "$RPC_URL",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$(solana address -k $DEPLOYER_KEYPAIR)",
  "programs": {
    "light_client": {
      "program_id": "$LIGHT_CLIENT_ID",
      "keypair": "target/deploy/solana_light_client_x1-keypair.json"
    },
    "mint": {
      "program_id": "$MINT_PROGRAM_ID",
      "keypair": "target/deploy/xencat_mint_x1-keypair.json"
    }
  }
}
EOF

echo -e "${GREEN}✓ Deployment info saved to deployment-info.json${NC}"
echo ""

echo "╔════════════════════════════════════════════════════════╗"
echo "║              DEPLOYMENT SUCCESSFUL                     ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Run: ./scripts/initialize.sh"
echo "  2. Test with: ./scripts/test-deployment.sh"
echo ""
