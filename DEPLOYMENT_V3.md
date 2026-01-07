# Asset-Aware Bridge V3 Deployment Guide

This document provides step-by-step instructions for deploying the asset-aware V3 implementation of the XENCAT bridge.

## Overview

**What's New in V3:**
- Asset-aware attestations (XENCAT, DGN, future assets)
- Cryptographic separation of different asset proofs
- PDA namespace separation prevents cross-asset replay
- XENCAT mint program enforces asset_id validation
- SPL mint detection in validator service

**Security Fix:**
V3 fixes a critical vulnerability where ANY SPL token burn on Solana could be used to mint XENCAT on X1.

---

## Security Invariants (Must Always Hold)

These invariants MUST hold at all times for the system to be secure:

- ✅ Total XENCAT minted on X1 ≤ total XENCAT burned on Solana
- ✅ DGN burns can NEVER mint XENCAT
- ✅ Each burn nonce can be processed once per asset (cross-asset nonces are isolated)
- ✅ Asset IDs are immutable and globally unique (NEVER reused or reassigned)
- ✅ Mint programs never trust validator services alone (cryptographic verification)
- ✅ V3 PDAs use different addresses than V2 PDAs (namespace separation)

---

## Prerequisites

### 1. Environment Setup

```bash
# Solana CLI
solana --version  # Should be ≥1.17.0

# Anchor CLI
anchor --version  # Should be ≥0.29.0

# Node.js
node --version    # Should be ≥16.0.0

# Rust
rustc --version   # Should be ≥1.70.0
```

### 2. Keypairs Required

- **Upgrade Authority**: Keypair with authority to upgrade programs
- **Validator Keys**: 5 validator Ed25519 keypairs (for attestation signing)
- **Test User**: Keypair for testing (with some XNT for fees)

### 3. Configuration

Create `.env` file:

```bash
# X1 Network
X1_RPC_URL=https://rpc.mainnet.x1.xyz
UPGRADE_AUTHORITY_PRIVATE_KEY=<your-upgrade-authority-private-key>

# Testing
USER_PRIVATE_KEY=<test-user-private-key>
XENCAT_BURN_NONCE=<existing-xencat-burn-for-testing>
```

---

## Deployment Steps

### Phase 1: Build and Verify Programs

#### Step 1.1: Build Programs

```bash
# Clean previous builds
anchor clean

# Build programs
anchor build
```

**Expected Output:**
```
✅ Light client program: solana_light_client_x1
✅ Mint program: xencat_mint_x1
✅ IDL files generated in target/idl/
```

#### Step 1.2: Regenerate and Verify IDL

```bash
# IDL is auto-generated during anchor build
ls -la target/idl/

# Should see:
# solana_light_client_x1.json (updated timestamp)
# xencat_mint_x1.json (updated timestamp)
```

**⚠️ CRITICAL: IDL Regeneration is REQUIRED**

After making code changes (adding V3 instructions), you MUST regenerate the IDL via `anchor build`.

**Important Notes:**
- IDL regeneration does NOT change program IDs
- IDL regeneration does NOT change existing PDA addresses (V2)
- V3 PDAs use NEW addresses due to different seeds (includes asset_id)
- The regenerated IDL contains the new V3 instruction definitions

**Verify V3 Instructions are in IDL:**
```bash
# Check light client IDL for submit_burn_attestation_v3
grep "submit_burn_attestation_v3" target/idl/solana_light_client_x1.json

# Check mint IDL for mint_from_burn_v3
grep "mint_from_burn_v3" target/idl/xencat_mint_x1.json
```

#### Step 1.3: Run Integration Tests

```bash
# Verify V3 implementation
npm run test:v3-integration
```

**Expected Output:**
```
✅ Tests passed: 5
✅ All V3 integration tests passed!
```

#### Step 1.4: Verify Program Addresses

Check that `declare_id!()` in programs match deployed addresses:

**Light Client** (`programs/solana-light-client-x1/src/lib.rs`):
```rust
declare_id!("BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5");
```

**Mint Program** (`programs/xencat-mint-x1/src/lib.rs`):
```rust
declare_id!("8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk");
```

---

### 📦 Important: Program IDs vs PDA Addresses

```
⚠️ Important:

✅ Upgrading the light client program does NOT change its program ID.
   The program ID remains: BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5

✅ However, V3 PDAs use NEW SEEDS and therefore NEW ADDRESSES.
   - V2 PDA: ["verified_burn_v2", user, nonce]
   - V3 PDA: ["verified_burn_v3", asset_id, user, nonce]

✅ The XENCAT mint program explicitly references the light client program ID
   via seeds::program = LIGHT_CLIENT_ID and does NOT need to be updated
   if the light client program ID remains the same.

✅ V2 and V3 PDAs can coexist without collision (different seed strings).
```

---

### Phase 2: Deploy Updated Programs

#### Step 2.1: Deploy Light Client Program

```bash
# Deploy light client with V3 instructions
anchor deploy --program-name solana-light-client-x1 \
  --provider.cluster mainnet \
  --provider.wallet ~/.config/solana/upgrade-authority.json
```

**Verification:**
```bash
# Check program was updated
solana program show BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5 --url https://rpc.mainnet.x1.xyz
```

#### Step 2.2: Deploy Mint Program

```bash
# Deploy mint program with V3 instructions
anchor deploy --program-name xencat-mint-x1 \
  --provider.cluster mainnet \
  --provider.wallet ~/.config/solana/upgrade-authority.json
```

**Verification:**
```bash
# Check program was updated
solana program show 8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk --url https://rpc.mainnet.x1.xyz
```

---

### Phase 3: Update Validator Services

**⚠️ Endpoint Naming Convention:**

V3 validator services MUST expose a distinct `/attest-burn-v3` endpoint to prevent accidental V2 usage.

- V2 Endpoint: `POST /attest-burn` (auto-detects XENCAT, no asset_id field)
- V3 Endpoint: `POST /attest-burn-v3` (detects SPL mint, returns asset_id)

This explicit separation ensures:
1. No accidental V2 usage when V3 is expected
2. Clear API versioning
3. Easier monitoring and debugging

#### Step 3.1: Deploy V3 Service to Each Validator

For each of the 5 validators:

1. **SSH into validator server:**
   ```bash
   ssh validator@149.50.116.159  # Example: Validator 1
   ```

2. **Navigate to service directory:**
   ```bash
   cd ~/xencat-validator-service
   ```

3. **Backup current service:**
   ```bash
   cp index.ts index-v2-backup.ts
   ```

4. **Deploy V3 service:**
   ```bash
   # Copy new V3 service file
   cp ~/xencat-light-client/validator-attestation-service/index-v3-asset-aware.ts index.ts

   # Install dependencies (if needed)
   npm install

   # Restart service
   pm2 restart xencat-validator
   ```

5. **Verify service is running:**
   ```bash
   pm2 status xencat-validator
   pm2 logs xencat-validator --lines 50
   ```

6. **Test V3 endpoint:**
   ```bash
   curl -X POST http://localhost:8080/attest-burn-v3 \
     -H "Content-Type: application/json" \
     -d '{
       "burn_nonce": 12345,
       "user": "...",
       "amount": 1000000,
       "validator_set_version": 1
     }'
   ```

   **Expected Response:**
   ```json
   {
     "asset_id": 1,
     "asset_name": "XENCAT",
     "burn_nonce": 12345,
     "user": "...",
     "amount": 1000000,
     "validator_set_version": 1,
     "validator_pubkey": "...",
     "signature": "...",
     "timestamp": 1234567890
   }
   ```

**Repeat for all 5 validators:**
- Validator 1: 149.50.116.159:8080
- Validator 2: 193.34.212.186:8080
- Validator 3: 74.50.76.62:10001
- Validator 4: 149.50.116.21:8080
- Validator 5: 64.20.49.142:8080

---

### Phase 4: Testing and Verification

#### Step 4.1: Test XENCAT Burn (V2 Compatibility)

Test that existing XENCAT burns still work with V2 path:

```bash
# Use existing burn nonce
BURN_NONCE=<existing-nonce> npm run test:bridge-v2
```

**Expected:**
- ✅ Attestations collected from validators
- ✅ V2 PDA created successfully
- ✅ XENCAT minted to user
- ✅ Fees distributed to validators

#### Step 4.2: Test XENCAT Burn (V3 Path)

Test new V3 path with XENCAT burn:

```bash
# This will test submit_burn_attestation_v3 and mint_from_burn_v3
XENCAT_BURN_NONCE=<nonce> npm run test:asset-security
```

**Expected:**
- ✅ Validators return asset_id=1 (XENCAT)
- ✅ V3 PDA created with asset namespace
- ✅ XENCAT minted successfully
- ✅ Asset validation enforced

#### Step 4.3: Test DGN Rejection (Critical Security Test)

If you have a DGN burn on Solana (optional but recommended):

```bash
# Test that DGN burns cannot mint XENCAT
DGN_BURN_NONCE=<dgn-nonce> npm run test:asset-security
```

**Expected:**
- ✅ Validators return asset_id=2 (DGN)
- ❌ XENCAT mint program REJECTS (AssetNotMintable error)
- ✅ Security enforced: DGN cannot mint XENCAT

#### Step 4.4: Test Unknown Mint Rejection

```bash
# Validators should reject unknown SPL mints
npm run test:asset-security
```

**Expected:**
- ✅ Validators return 400/404 for unknown mints
- ✅ Only XENCAT and DGN are accepted

#### Step 4.5: Test Mixed Nonce Streams (Interleaving)

**Critical Test:** Verify that XENCAT and DGN nonces can interleave without collision.

**Scenario:**
- Burn XENCAT with nonces: 1, 3, 7, 10
- Burn DGN with nonces: 2, 4, 5, 9
- Process them in mixed order: 1, 2, 3, 4, 5, 7, 9, 10

**Expected:**
- ✅ All burns process successfully
- ✅ XENCAT nonces create PDAs: `["verified_burn_v3", 1, user, nonce]`
- ✅ DGN nonces create PDAs: `["verified_burn_v3", 2, user, nonce]`
- ✅ No PDA collisions
- ✅ Each asset tracks its own processed nonces independently

This test confirms that asset namespace separation works correctly.

---

### Phase 5: Post-Deployment Verification

#### Step 5.1: Verify Program State

```bash
# Check validator set
solana account GPzF2wcsV5PxWTQRNGRPmkTZPiDM1kcFfpiCGeraXnSJ --url https://rpc.mainnet.x1.xyz

# Check mint state
solana account CpEv4bdRv8SLT3N8KpaPVcdqdCM9nzahjMYXgDsxdQ1W --url https://rpc.mainnet.x1.xyz
```

#### Step 5.2: Monitor Validator Services

```bash
# SSH to each validator
ssh validator@<ip>

# Check service status
pm2 status xencat-validator

# Check recent logs for errors
pm2 logs xencat-validator --lines 100 | grep ERROR

# Monitor V3 attestation requests (note the endpoint)
pm2 logs xencat-validator --lines 100 | grep "attest-burn-v3"
```

#### Step 5.3: Test with Real User Flow

Have a test user perform a complete flow:

1. Burn XENCAT on Solana
2. Request V3 attestations from validators (via `/attest-burn-v3`)
3. Submit attestations to X1
4. Mint XENCAT tokens

**Monitor:**
- Validator logs show correct asset detection
- X1 transactions succeed
- User receives correct amount
- Fees distributed properly

---

## Rollback Plan

If issues are discovered after deployment:

### Option 1: Revert Programs (If Critical Bug)

```bash
# Revert to previous program version
solana program deploy --program-id <program-id> \
  --buffer <previous-buffer> \
  --upgrade-authority ~/.config/solana/upgrade-authority.json \
  --url https://rpc.mainnet.x1.xyz
```

### Option 2: Revert Validator Services

```bash
# On each validator
cd ~/xencat-validator-service
cp index-v2-backup.ts index.ts
pm2 restart xencat-validator
```

### Option 3: Dual-Path Operation

V2 and V3 can coexist:
- V2 path: `submit_burn_attestation` → `mint_from_burn`
- V3 path: `submit_burn_attestation_v3` → `mint_from_burn_v3`

Users can continue using V2 while V3 is debugged.

---

## Monitoring

### Key Metrics to Monitor

1. **Validator Service Health:**
   - Request success rate
   - Response times
   - Error rates (especially 400/404)

2. **On-Chain Metrics:**
   - Successful mint transactions
   - Failed transactions (and error types)
   - V2 vs V3 usage split

3. **Security Metrics:**
   - Any AssetNotMintable errors (attempted cross-asset minting)
   - Any InvalidAsset errors
   - Unknown mint rejection rate

### Alerting

Set up alerts for:
- Validator service downtime
- High error rates (>5%)
- Any AssetNotMintable errors (security incident)
- Transaction failures

---

## Migration Path

### Immediate (Day 1):
- Deploy V3 programs ✅
- Deploy V3 validator services ✅
- V2 and V3 coexist ✅

### Week 1-2:
- Monitor V3 usage
- Fix any discovered issues
- Educate users about V3

### Week 3-4:
- Increase V3 adoption
- Consider deprecating V2

### Month 2+:
- V3 becomes primary path
- V2 kept for legacy compatibility

---

## Security Considerations

### Before Making Immutable

**Required:**
1. ✅ All integration tests pass
2. ✅ Security test suite passes (242+ tests)
3. ✅ Professional security audit completed
4. ✅ 30+ days of mainnet usage without critical issues
5. ✅ Multiple validator set rotations tested

**Once Immutable:**
- No more program upgrades possible
- Validators become sole governance mechanism
- Any bugs must be fixed via new deployment (new program ID)

### Security Checklist

- [ ] All V3 instructions deployed
- [ ] Validator services updated
- [ ] Integration tests pass
- [ ] Security tests pass
- [ ] Real user testing completed
- [ ] No critical bugs for 30+ days
- [ ] Backup/rollback plan tested
- [ ] Professional audit completed

---

## Troubleshooting

### Issue: Validators Return 404 for V3 Endpoint

**Cause:** V3 service not deployed
**Fix:**
```bash
ssh validator@<ip>
cd ~/xencat-validator-service
cp ~/xencat-light-client/validator-attestation-service/index-v3-asset-aware.ts index.ts
pm2 restart xencat-validator
```

### Issue: AssetNotMintable Error

**Cause:** Attempting to mint non-XENCAT asset
**Expected:** This is correct behavior!
**Action:** Verify asset_id in attestation, should be 1 for XENCAT

### Issue: InvalidAttestation Error

**Cause:** Asset_id mismatch between parameters and attestation data
**Fix:** Ensure client passes correct asset_id to instruction

### Issue: PDA Derivation Error

**Cause:** Incorrect seed format
**Fix:** Verify using `.to_le_bytes().as_ref()` for numeric seeds

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/anthropics/xencat-light-client/issues
- Discord: [Add Discord link]
- Email: [Add support email]

---

## Appendix: Asset Registry

### Current Assets (Permanent IDs)

| Asset ID | Name | Solana Mint | X1 Mint | Mint Program |
|----------|------|-------------|---------|--------------|
| 1 | XENCAT | `7UN8Wk...` | `DQ6sAp...` | `8kmoPK...` (this program) |
| 2 | DGN | `Fd8TNp...` | TBD | TBD (separate program) |

**CRITICAL:** Asset IDs are PERMANENT. Never reuse or reassign.

---

### 🚫 DO NOT MODIFY XENCAT MINT PROGRAM FOR NEW ASSETS

```
⚠️ NEVER add new assets to the XENCAT mint program.

Each asset MUST have its own mint program.

Why:
1. Security isolation: One program = one asset
2. Immutability: XENCAT mint will be made immutable
3. Governance: Each asset has independent governance
4. Audit: One program = one security boundary

To add a new asset (e.g., DGN):
1. Create NEW mint program (copy xencat-mint-x1 as template)
2. Change asset_id check: require!(asset_id == ASSET_DGN, ...)
3. Deploy with NEW program ID
4. Update validator service asset registry
5. Test independently

DO NOT:
❌ Add asset_id parameter to XENCAT mint program
❌ Add if/else logic for different assets
❌ Reuse XENCAT mint program for other assets
```

---

### Adding New Assets

To add support for a new asset (e.g., DGN):

1. **Create new mint program** (DO NOT modify XENCAT mint program)
   ```bash
   cp -r programs/xencat-mint-x1 programs/dgn-mint-x1
   # Update program ID, asset_id check, etc.
   ```

2. **Add asset to validator service registry**
   ```typescript
   const ASSET_BY_MINT: Record<string, Asset> = {
       [XENCAT_MINT.toBase58()]: Asset.XENCAT,
       [DGN_MINT.toBase58()]: Asset.DGN,  // Add this
   };
   ```

3. **Add Asset enum variant** (if needed)
   ```rust
   pub enum Asset {
       XENCAT = 1,
       DGN = 2,  // Add this
   }
   ```

4. **Test thoroughly before deployment**

Each asset MUST have:
- Unique asset_id (never reused)
- Separate mint program
- Entry in validator service asset registry

---

## Changelog

### V3.0.0 (Current)
- Added asset-aware attestations
- Added submit_burn_attestation_v3 instruction
- Added mint_from_burn_v3 instruction
- Added SPL mint detection in validator service
- Fixed vulnerability: Any SPL token could mint XENCAT
- Added ProcessedBurnV3 with asset_id field
- Added VerifiedBurnV3 with asset_id field

### V2.0.0 (Legacy)
- Validator attestation model
- Non-custodial fee distribution
- Threshold governance (3-of-5)

---

**End of Deployment Guide**

For questions or clarifications, refer to `CLAUDE.md` for detailed architecture and security documentation.
