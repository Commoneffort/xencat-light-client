# XENCAT Light Client Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/rust-1.75%2B-orange.svg)](https://www.rust-lang.org/)
[![Anchor](https://img.shields.io/badge/anchor-0.29-blue.svg)](https://www.anchor-lang.com/)
[![Security Tests](https://img.shields.io/badge/security_tests-250%2B-green.svg)](TESTS.md)

**Trustless, Byzantine fault-tolerant asset-aware bridge for multi-asset token bridging from Solana to X1**

## 🌉 Overview

The XENCAT Bridge is a **trustless, production-ready** multi-asset bridge that enables secure cross-chain transfer of tokens (XENCAT, DGN, and future assets) from Solana mainnet to X1 chain using an asset-aware validator attestation model with cryptographic security guarantees.

### Key Features

- ✅ **Asset-Aware Architecture**: Cryptographically binds attestations to specific assets (V3)
- ✅ **Multi-Asset Support**: XENCAT and DGN with isolated mint programs
- ✅ **Trustless Architecture**: No reliance on centralized parties or oracles
- ✅ **Byzantine Fault Tolerance**: 3-of-5 validator threshold (tolerates 2 malicious validators)
- ✅ **Cryptographic Security**: Ed25519 signatures with asset, amount, and user binding
- ✅ **No Admin Authority**: Threshold governance only - immutable after deployment
- ✅ **Comprehensive Testing**: 250+ security tests with 100% pass rate
- ✅ **Production Ready**: Operating on X1 mainnet with real value transfer
- ✅ **Validator Fee Distribution**: Automatic 0.01 XNT payment per validator as anti-spam verification fee

## 🏗️ Architecture

```
Solana Mainnet                     X1 Mainnet
┌─────────────────┐               ┌──────────────────┐
│  XENCAT / DGN   │               │  XENCAT / DGN    │
│  (Burn)         │               │  (Mint)          │
└────────┬────────┘               └────────▲─────────┘
         │                                  │
         │ 1. User burns tokens            │ 4. Mint + fees
         ▼                                  │
┌─────────────────┐               ┌────────┴─────────┐
│  Burn Program   │               │ Asset-Specific   │
│  Creates PDA    │               │ Mint Programs    │
└────────┬────────┘               │ (V3 Isolated)    │
         │                        └────────▲─────────┘
         │                                  │
         │ 2. Request attestations          │ 3. Submit attestations
         │    from validators               │    (threshold: 3/5)
         │    (with asset_id)               │    (asset-aware V3)
         ▼                                  │
┌─────────────────────────────────────────┴┐
│     5 Validator Attestation Services     │
│  (Independent X1 validators)             │
│                                           │
│  Each validator:                          │
│  - Verifies burn on Solana (RPC)         │
│  - Detects SPL mint (asset whitelist)    │
│  - Maps to asset_id (1=XENCAT, 2=DGN)    │
│  - Checks finality (32 slots)            │
│  - Signs asset-aware attestation         │
│  - Returns signature to user             │
│  - Receives 0.01 XNT fee per mint        │
└───────────────────────────────────────────┘
```

### Core Components

1. **Light Client Program** (`programs/solana-light-client-x1/`)
   - Verifies asset-aware validator attestations (V3)
   - Manages validator set with threshold governance (3-of-5)
   - Version-bound and asset-bound attestations for replay protection
   - Domain-separated signatures (`XENCAT_X1_BRIDGE_V1`)
   - Shared across all assets (XENCAT, DGN)

2. **XENCAT Mint Program** (`programs/xencat-mint-x1/`)
   - XENCAT-specific minting logic (asset_id = 1)
   - Verifies burn attestations via CPI to light client
   - Distributes fees to validators (0.01 XNT per validator)
   - Asset-aware replay prevention via V3 PDAs

3. **DGN Mint Program** (`programs/dgn-mint-x1/`)
   - DGN-specific minting logic (asset_id = 2)
   - Isolated from XENCAT (separate PDAs, separate authority)
   - Same verification and fee distribution model
   - Asset-aware replay prevention via V3 PDAs

4. **Validator Attestation Service** (`validator-attestation-service/`)
   - TypeScript service running on each validator node
   - Verifies Solana burns via RPC
   - Detects SPL mint and maps to asset_id
   - Enforces asset whitelist (XENCAT and DGN only)
   - Signs asset-aware attestations with validator's Ed25519 key
   - REST API for users to collect attestations

5. **Solana Burn Program** (`solana-burn-program/`)
   - Deployed on Solana mainnet
   - Creates burn records for any SPL token
   - Program ID: `2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp`

## 🔐 Security Model

### Trust Assumptions

**The ONLY trust assumption**: At least 3 of 5 validators are honest.

After that, security is guaranteed by:
- ✅ **Asset Binding**: Asset_id + amount + user in signature (V3 - prevents manipulation and cross-asset replay)
- ✅ **Threshold Consensus**: 3-of-5 signatures required (Byzantine tolerance)
- ✅ **Version Binding**: Attestations bound to validator set version
- ✅ **Domain Separation**: Unique domain tag prevents cross-protocol replay
- ✅ **Finality Enforcement**: 32-slot waiting period prevents reorg attacks
- ✅ **PDA-based Replay Protection**: Asset-aware on-chain nonce tracking (V3)

### Security Testing

**250+ comprehensive security tests** (100% pass rate):
- ✅ 5 V3 asset isolation tests (cross-asset replay, asset substitution, etc.)
- ✅ 25 V2 migration tests (mint authority, fees, replay attacks, E2E)
- ✅ 41 original security tests (Byzantine attacks, threshold, replay, etc.)
- ✅ 119 fuzzing tests (random malformed inputs)
- ✅ 5 serialization tests (Borsh canonicalization)
- ✅ 18 attack vector categories tested (all blocked)

See [TESTS.md](TESTS.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md), and [RED_TEAM_TESTS.md](RED_TEAM_TESTS.md) for details.

### Verified Attack Prevention

| Attack Type | Protection Mechanism | Status |
|-------------|---------------------|--------|
| Cross-asset replay | Asset_id in signature + asset-aware PDAs | ✅ BLOCKED |
| Asset substitution | Asset whitelist + on-chain enforcement | ✅ BLOCKED |
| Replay attacks | PDA-based nonce tracking | ✅ BLOCKED |
| Amount manipulation | Amount in signature | ✅ BLOCKED |
| User impersonation | User pubkey in signature | ✅ BLOCKED |
| Validator set injection | Version binding | ✅ BLOCKED |
| Cross-burn signature replay | Different PDAs per nonce | ✅ BLOCKED |
| Reorg attacks | 32-slot finality check | ✅ BLOCKED |
| Insufficient threshold | 3-of-5 enforcement | ✅ BLOCKED |
| Economic overflow | Multi-layer overflow protection | ✅ BLOCKED |

## 🚀 Quick Start

### Prerequisites

- **Rust**: 1.75+ with Anchor framework 0.29+
- **Node.js**: 18.x+ with npm 9.x+
- **Solana CLI**: Latest version
- **X1 CLI**: Configured for X1 mainnet

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/xencat-light-client.git
cd xencat-light-client

# Install dependencies
npm install

# Build programs
anchor build
```

### Building

```bash
# Build Anchor programs
anchor build

# Build TypeScript SDKs
cd sdk/attestation-client && npm run build
cd ../..

# Run tests
anchor test
```

### Testing

```bash
# Run comprehensive test suite
npm run test

# Run V2 migration security tests
npm run test:v2-migration
npm run test:v2-fees
npm run test:v2-replay

# Run original security tests
npm run test:byzantine
npm run test:fuzzing
npm run test:serialization
```

## 📡 Deployed Contracts (X1 Mainnet)

### Programs

| Program | Address | Status |
|---------|---------|--------|
| **Light Client** | `BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5` | ✅ Active (V3) |
| **XENCAT Mint Program** | `8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk` | ✅ Active (V3) |
| **DGN Mint Program** | `4YPipW8txxY3N7gHdj4NLhu8YxybHgarx5dJQCdCnQHs` | ✅ Active (V3) |
| **XENCAT Token (X1)** | `DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb` | ✅ Active |
| **DGN Token (X1)** | `84PxDRsNyiRJU4gfFiD7RqvZzqh5FdqXjDdtFV3N3oxc` | ✅ Active |

### Solana Mainnet

| Component | Address |
|-----------|---------|
| **XENCAT Token** | `7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V` |
| **DGN Token** | `Fd8TNp5GhhTk6Uq6utMvK13vfQdLN1yUUHCnapWvpump` |
| **Burn Program** | `2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp` |

### Validator Set

**Version**: 1 (Current)
**Threshold**: 3 of 5 validators

| # | Public Key | Endpoint | Status |
|---|------------|----------|--------|
| 1 | `9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH` | http://149.50.116.159:8080 | ✅ Online |
| 2 | `8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag` | http://193.34.212.186:8080 | ✅ Online |
| 3 | `5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um` | http://74.50.76.62:10001 | ✅ Online |
| 4 | `GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH` | http://149.50.116.21:8080 | ✅ Online |
| 5 | `FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj` | http://64.20.49.142:8080 | ✅ Online |

## 💰 Fee Structure (V2)

- **Fee per Validator**: 0.01 XNT (10,000,000 lamports with 9 decimals)
- **Total Fee per Mint**: 0.05 XNT (5 validators × 0.01 XNT)
- **Payment Currency**: XNT (X1 native token, NOT XENCAT)
- **Distribution**: Automatic, non-custodial via `system_instruction::transfer`
- **Timing**: Paid during minting transaction (instant)

## 🛠️ Usage

### For Users: Bridging XENCAT from Solana to X1

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { AttestationClient } from '@xencat/attestation-client';

// 1. Burn XENCAT on Solana (using burn program)
const burnTx = await burnProgram.methods
  .burn(amount)
  .accounts({ /* ... */ })
  .rpc();

// 2. Wait for finality (32 slots, ~13 seconds)
await new Promise(resolve => setTimeout(resolve, 15000));

// 3. Collect attestations from validators
const client = new AttestationClient(validators);
const attestations = await client.collectAttestations({
  burnNonce: nonce,
  user: userPubkey,
  expectedAmount: amount,
  validatorSetVersion: 1
});

// 4. Submit attestations to X1 and mint tokens
const mintTx = await mintProgram.methods
  .mintFromBurn(nonce, amount, validatorSetVersion, attestations)
  .accounts({ /* ... */ })
  .rpc();
```

See [scripts/test-bridge-v2.ts](scripts/test-bridge-v2.ts) for complete example.

### For Validators: Running Attestation Service

See [validator-attestation-service/README.md](validator-attestation-service/README.md) for comprehensive onboarding guide.

**Quick setup**:

```bash
cd validator-attestation-service
npm install
cp .env.example .env
# Edit .env with your validator keypair
npm start
```

## 📚 Documentation

### Core Documentation

- **[CHANGELOG.md](CHANGELOG.md)** - Version history (V1 → V2 → V3)
- **[SECURITY_AUDIT.md](SECURITY_AUDIT.md)** - V3 security audit (asset-aware architecture)
- **[PROJECT_STATUS.md](PROJECT_STATUS.md)** - Complete project status, deployment info, security testing
- **[TESTS.md](TESTS.md)** - Comprehensive test results (250+ tests, 100% pass rate)
- **[RED_TEAM_TESTS.md](RED_TEAM_TESTS.md)** - Red team security testing (242+ tests)
- **[CLAUDE.md](CLAUDE.md)** - Development guidelines and project overview

### V3 Documentation

- **[V3_IMPLEMENTATION_SUMMARY.md](V3_IMPLEMENTATION_SUMMARY.md)** - V3 implementation details
- **[ASSET_AWARE_IMPLEMENTATION_PLAN.md](ASSET_AWARE_IMPLEMENTATION_PLAN.md)** - V3 planning document
- **[DEPLOYMENT_V3.md](DEPLOYMENT_V3.md)** - V3 deployment guide

### Design Documents

- **[NO_ADMIN_DESIGN.md](NO_ADMIN_DESIGN.md)** - Threshold governance design
- **[FEE_DISTRIBUTION_CHANGES.md](FEE_DISTRIBUTION_CHANGES.md)** - V2 fee distribution changes

### Validator Documentation

- **[validator-attestation-service/README.md](validator-attestation-service/README.md)** - Validator onboarding guide

## 🔧 Development

### Project Structure

```
xencat-light-client/
├── programs/                    # Anchor programs (Rust)
│   ├── solana-light-client-x1/  # Light client program (V3 asset-aware)
│   ├── xencat-mint-x1/          # XENCAT mint program (V3)
│   └── dgn-mint-x1/             # DGN mint program (V3)
├── solana-burn-program/         # Solana burn program (deployed on Solana)
├── validator-attestation-service/ # Validator service (TypeScript V3)
├── scripts/                     # Deployment & test scripts
│   ├── initialize-*.ts          # Setup scripts
│   ├── test-v3-*.ts             # V3 security test scripts
│   ├── bridge-mint.ts           # Universal bridge mint script
│   └── burn-*.ts                # Burn scripts
├── tests/                       # Anchor tests
└── examples/                    # Example integrations
```

### Running Local Tests

```bash
# Start local validator
solana-test-validator

# Run Anchor tests
anchor test

# Run specific security tests
npx ts-node scripts/test-v2-migration-security.ts
npx ts-node scripts/test-fuzzing.ts
npx ts-node scripts/test-byzantine-conflicts.ts
```

### Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`anchor test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request


### Security Audits

- ✅ Internal security testing: 250+ tests (100% pass rate)
- ✅ V3 asset-aware architecture audit (Jan 2026)
- ✅ V2 migration audit: 25 tests (Dec 2025)

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for comprehensive V3 audit results.

## 📊 Performance

- **Compute Units**: <15,000 CU per verification (efficient!)
- **Latency**: ~2-5 seconds for attestation collection
- **Throughput**: Limited by validator response time
- **Finality**: 32 slots (~13 seconds) on Solana

## 🗺️ Roadmap

### Current Status (V3 - Production)

- ✅ Asset-aware attestation model deployed
- ✅ Multi-asset support (XENCAT, DGN)
- ✅ Byzantine fault tolerance (3-of-5)
- ✅ Fee distribution system operational
- ✅ 250+ security tests passed
- ✅ Operating on X1 mainnet

## 🔐 Security Architecture (Summary)

The bridge uses an asset-aware attestation model:

- Burns on Solana are attested by independent validators
- Attestations are cryptographically bound to a specific asset_id
- Each asset (e.g. XENCAT, DGN) has its own mint program on X1
- Mint authority is held by program-derived addresses (PDAs), not wallets
- Cross-asset minting is prevented at both the light client and mint layers

This design prevents replay attacks and unauthorized minting even if
validators attest multiple assets.

## ❓ FAQ

### Q: Is the bridge trustless?

**A**: Yes. The only trust assumption is that at least 3 of 5 validators are honest. All verification is cryptographic and on-chain. No centralized parties or oracles.

### Q: What happens if validators go offline?

**A**: The bridge continues to operate with any 3 of 5 validators online (Byzantine fault tolerance). If less than 3 are available, the bridge halts safely until validators come back online.

### Q: How are validator fees paid?

**A**: Automatically during minting. Each validator receives 0.01 XNT (native X1 token) per signature verification, distributed via `system_instruction::transfer`. No withdrawal needed.

### Q: Can the programs be upgraded?

**A**: Currently yes (upgrade authority: Validator 1). Programs will be made **immutable** after extensive mainnet usage and professional security audit (planned Q1 2026).

### Q: How do I bridge XENCAT tokens?

**A**:
1. Burn XENCAT on Solana using burn program
2. Wait 32 slots for finality (~13 seconds)
3. Collect attestations from validators (use SDK)
4. Submit attestations to X1 and mint tokens

See [Usage](#-usage) section for code examples.

### Q: What's the difference between V1 and V2?

**A**: V2 introduced validator fee distribution (0.01 XNT per validator). V1 used a single fee receiver. V2 is more decentralized and aligns validator incentives. V1 is permanently disabled.

## 🙏 Acknowledgments

- **Solana Foundation** - For the Solana blockchain
- **X1 Team** - For the X1 chain (SVM fork)
- **Anchor Framework** - For the Anchor framework
- **All Validators** - For securing the bridge

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Documentation**: [docs/](docs/)
- **Security Audits**: [FINAL_V2_SECURITY_REPORT.md](FINAL_V2_SECURITY_REPORT.md)
- **Test Results**: [TESTS.md](TESTS.md)
- **Project Status**: [PROJECT_STATUS.md](PROJECT_STATUS.md)

---

**Built with ❤️ by the XENCAT team**

**Bridge Status**: ✅ Production Ready (V3 Asset-Aware) | **Security**: 250+ tests passed | **Fee**: 0.05 XNT per mint
