#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════╗"
echo "║   XENCAT Light Client - Program Initialization        ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load deployment info
if [ ! -f "deployment-info.json" ]; then
    echo "ERROR: deployment-info.json not found. Run deploy.sh first."
    exit 1
fi

LIGHT_CLIENT_ID=$(jq -r '.programs.light_client.program_id' deployment-info.json)
MINT_PROGRAM_ID=$(jq -r '.programs.mint.program_id' deployment-info.json)
RPC_URL=$(jq -r '.rpc_url' deployment-info.json)

echo "Program IDs:"
echo "  Light Client: $LIGHT_CLIENT_ID"
echo "  Mint Program: $MINT_PROGRAM_ID"
echo ""

cd "$(dirname "$0")/.."

# Initialize Light Client
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Initializing Light Client..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "NOTE: You need to provide genesis validator set data"
echo "This should come from Solana mainnet validators at a specific slot"
echo ""
echo "For testing, you can use a small validator set:"
echo ""
cat << 'EOF'
// Example validator set (for testing only)
const validatorSet = [
  {
    identity: new PublicKey("Vote111111111111111111111111111111111111111"),
    stake: 1000000000000 // 1000 SOL
  },
  {
    identity: new PublicKey("Vote222222222222222222222222222222222222222"),
    stake: 500000000000  // 500 SOL
  }
];

const totalStake = 1500000000000; // 1500 SOL total
EOF

echo ""
echo "Run the TypeScript initialization script:"
echo "  ts-node scripts/init-light-client.ts"
echo ""

# Initialize Mint Program
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Initializing Mint Program..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "Run the TypeScript initialization script:"
echo "  ts-node scripts/init-mint-program.ts"
echo ""

echo -e "${GREEN}Initialization scripts ready!${NC}"
echo ""
echo "Next: Create and run the TypeScript initialization scripts"
