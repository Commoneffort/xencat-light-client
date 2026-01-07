# Asset-Aware Bridge V3 - Quick Reference

**Last Updated:** 2026-01-06

Quick reference for developers integrating with the asset-aware bridge V3.

---

## At a Glance

### What Changed in V3?

| Feature | V2 (Legacy) | V3 (Asset-Aware) |
|---------|-------------|------------------|
| **Assets Supported** | XENCAT only (implicit) | XENCAT, DGN, future assets (explicit) |
| **Attestation Hash** | `hash(DOMAIN \|\| version \|\| nonce \|\| amount \|\| user)` | `hash(DOMAIN \|\| asset_id \|\| version \|\| nonce \|\| amount \|\| user)` |
| **PDA Seeds** | `["verified_burn_v2", user, nonce]` | `["verified_burn_v3", asset_id, user, nonce]` |
| **Mint Enforcement** | None (trusted validators) | `require!(asset_id == 1)` |
| **Cross-Asset Replay** | Vulnerable | Protected (different PDAs) |
| **Validator Endpoint** | `POST /attest-burn` | `POST /attest-burn-v3` |

---

## Program IDs (Unchanged)

```typescript
const LIGHT_CLIENT_PROGRAM = "BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5";
const MINT_PROGRAM = "8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk";
```

---

## Asset IDs (Permanent)

```rust
enum Asset {
    XENCAT = 1,  // Never changes
    DGN = 2,     // Never changes
}
```

**CRITICAL:** Asset IDs are immutable and never reused.

---

## PDA Derivation

### V3 Verified Burn (Light Client)

```typescript
const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
    [
        Buffer.from('verified_burn_v3'),
        Buffer.from([assetId]),  // u8: 1 byte
        user.toBuffer(),         // Pubkey: 32 bytes
        Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer), // u64: 8 bytes
    ],
    LIGHT_CLIENT_PROGRAM
);
```

### V3 Processed Burn (Mint Program)

```typescript
const [processedBurnPda] = PublicKey.findProgramAddressSync(
    [
        Buffer.from('processed_burn_v3'),
        Buffer.from([assetId]),
        Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
        user.toBuffer(),
    ],
    MINT_PROGRAM
);
```

### V2 Verified Burn (Legacy - Still Supported)

```typescript
const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
    [
        Buffer.from('verified_burn_v2'),
        user.toBuffer(),
        Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
    ],
    LIGHT_CLIENT_PROGRAM
);
```

---

## Validator Service API

### V3 Endpoint: Request Attestation

**Endpoint:** `POST /attest-burn-v3`

**Request:**
```json
{
  "burn_nonce": 12345,
  "user": "5v6a6eQw8kv6Uhajv2QqA2qKqMhCWRZGkvZXwJsBS2uH",
  "amount": 1000000,
  "validator_set_version": 1
}
```

**Response (Success):**
```json
{
  "asset_id": 1,
  "asset_name": "XENCAT",
  "burn_nonce": 12345,
  "user": "5v6a6eQw8kv6Uhajv2QqA2qKqMhCWRZGkvZXwJsBS2uH",
  "amount": 1000000,
  "validator_set_version": 1,
  "validator_pubkey": "9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH",
  "signature": "3f4a2b...c8d9e0",
  "timestamp": 1234567890
}
```

**Response (Error - Unknown Mint):**
```json
{
  "error": "Unknown asset - mint not found in burn transaction"
}
```

**Response (Error - Not Finalized):**
```json
{
  "error": "Burn not yet finalized - wait 32 slots (~13 seconds)"
}
```

---

## Client Integration Examples

### Example 1: Collect V3 Attestations

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

const VALIDATORS = [
    'http://149.50.116.159:8080',
    'http://193.34.212.186:8080',
    'http://74.50.76.62:10001',
    'http://149.50.116.21:8080',
    'http://64.20.49.142:8080',
];

async function collectAttestationsV3(
    burnNonce: number,
    user: PublicKey,
    amount: number,
    validatorSetVersion: number
) {
    const attestations = [];

    for (const validatorUrl of VALIDATORS) {
        try {
            const response = await fetch(`${validatorUrl}/attest-burn-v3`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: burnNonce,
                    user: user.toBase58(),
                    amount,
                    validator_set_version: validatorSetVersion,
                }),
            });

            if (!response.ok) {
                console.warn(`Validator ${validatorUrl} failed: ${response.status}`);
                continue;
            }

            const attestation = await response.json();
            attestations.push(attestation);

            // Need at least 3 attestations (threshold)
            if (attestations.length >= 3) {
                break;
            }
        } catch (err) {
            console.warn(`Validator ${validatorUrl} error:`, err);
        }
    }

    if (attestations.length < 3) {
        throw new Error(`Insufficient attestations: got ${attestations.length}, need 3`);
    }

    return attestations;
}
```

### Example 2: Submit V3 Attestation to Light Client

```typescript
import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

async function submitBurnAttestationV3(
    program: anchor.Program,
    user: Keypair,
    assetId: number,
    burnNonce: number,
    attestations: any[]
) {
    // Derive V3 PDA
    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([assetId]),
            user.publicKey.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
        ],
        program.programId
    );

    // Get validator set
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        program.programId
    );

    // Build attestation data
    const attestationData = {
        assetId,
        burnNonce,
        user: user.publicKey,
        amount: attestations[0].amount,
        validatorSetVersion: attestations[0].validator_set_version,
        attestations: attestations.map(a => ({
            validatorPubkey: new PublicKey(a.validator_pubkey),
            signature: Array.from(Buffer.from(a.signature, 'hex')),
            timestamp: a.timestamp,
        })),
    };

    // Submit to light client
    const tx = await program.methods
        .submitBurnAttestationV3(assetId, burnNonce, attestationData)
        .accounts({
            user: user.publicKey,
            validatorSet: validatorSetPda,
            verifiedBurn: verifiedBurnPda,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

    console.log('Attestation submitted:', tx);
    return verifiedBurnPda;
}
```

### Example 3: Mint from V3 Verified Burn

```typescript
async function mintFromBurnV3(
    mintProgram: anchor.Program,
    lightClientProgramId: PublicKey,
    user: Keypair,
    assetId: number,
    burnNonce: number,
    validators: PublicKey[]
) {
    // Get mint state
    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        mintProgram.programId
    );

    // Get XENCAT mint
    const xencatMint = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
        xencatMint,
        user.publicKey
    );

    // Get validator set
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        lightClientProgramId
    );

    // Get verified burn PDA (from light client)
    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([assetId]),
            user.publicKey.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
        ],
        lightClientProgramId
    );

    // Get processed burn PDA
    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn_v3'),
            Buffer.from([assetId]),
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
            user.publicKey.toBuffer(),
        ],
        mintProgram.programId
    );

    // Call mint_from_burn_v3
    const tx = await mintProgram.methods
        .mintFromBurnV3(burnNonce, assetId)
        .accounts({
            mintState: mintStatePda,
            xencatMint,
            processedBurn: processedBurnPda,
            userTokenAccount,
            user: user.publicKey,
            validatorSet: validatorSetPda,
            verifiedBurn: verifiedBurnPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(
            // Pass validator accounts for fee distribution
            validators.map(v => ({
                pubkey: v,
                isWritable: true,
                isSigner: false,
            }))
        )
        .signers([user])
        .rpc();

    console.log('Minted from burn V3:', tx);
}
```

---

## Common Errors

### `AssetNotMintable`

**Cause:** Trying to mint non-XENCAT asset with XENCAT mint program

**Solution:** Each asset needs its own mint program. DGN will have a separate program.

```rust
// This is CORRECT in XENCAT mint program
require!(asset_id == 1, MintError::AssetNotMintable);
```

### `InvalidAttestation`

**Cause:** Mismatch between instruction parameters and attestation data

**Solution:** Ensure `asset_id` and `burn_nonce` match in both places:

```typescript
// WRONG
await program.methods.submitBurnAttestationV3(
    1,      // asset_id parameter
    12345,  // burn_nonce parameter
    {
        assetId: 2,      // ❌ Mismatch!
        burnNonce: 12345,
        // ...
    }
)

// CORRECT
await program.methods.submitBurnAttestationV3(
    1,      // asset_id parameter
    12345,  // burn_nonce parameter
    {
        assetId: 1,      // ✅ Match
        burnNonce: 12345,
        // ...
    }
)
```

### `AssetMismatch`

**Cause:** Verified burn has different asset_id than requested

**Solution:** Use correct PDA for the asset you're minting

### `ValidatorSetVersionMismatch`

**Cause:** Trying to use attestations with old validator set version

**Solution:** Get current validator set version and request fresh attestations

---

## Migration Guide: V2 → V3

### For Existing Integrations

**Option 1: Keep Using V2 (Backward Compatible)**
- No changes needed
- V2 continues to work for XENCAT
- `submit_burn_attestation` + `mint_from_burn`

**Option 2: Migrate to V3 (Recommended)**
- Update validator requests to `/attest-burn-v3`
- Use `submit_burn_attestation_v3` instruction
- Use `mint_from_burn_v3` instruction
- Include `asset_id` in all calls

### Key Differences

```typescript
// V2 (still works)
const [verifiedBurn] = PublicKey.findProgramAddressSync(
    [
        Buffer.from('verified_burn_v2'),
        user.toBuffer(),
        burnNonce.toBuffer(),
    ],
    lightClientProgram
);

// V3 (recommended)
const [verifiedBurn] = PublicKey.findProgramAddressSync(
    [
        Buffer.from('verified_burn_v3'),
        Buffer.from([1]),  // asset_id = XENCAT
        user.toBuffer(),
        burnNonce.toBuffer(),
    ],
    lightClientProgram
);
```

---

## Testing Checklist

Before going to production:

- [ ] Test XENCAT burn with V3 path
- [ ] Test V2 backward compatibility
- [ ] Test DGN burn rejection (security)
- [ ] Test unknown mint rejection
- [ ] Test insufficient attestations (<3)
- [ ] Test expired attestations
- [ ] Test validator downtime
- [ ] Test concurrent burns (different nonces)
- [ ] Test fee distribution to all validators
- [ ] Test PDA uniqueness (no collisions)

---

## Performance & Fees

### Transaction Costs

| Operation | Compute Units | XNT Fee |
|-----------|--------------|---------|
| `submit_burn_attestation_v3` | ~15,000 CU | ~0.001 XNT |
| `mint_from_burn_v3` | ~10,000 CU | 0.05 XNT (to validators) |
| **Total per burn** | ~25,000 CU | ~0.051 XNT |

### Fee Breakdown

- **Validator fees:** 0.01 XNT × 5 = 0.05 XNT
- **Solana transaction fee:** ~0.001 XNT
- **Total:** ~0.051 XNT per burn/mint cycle

---

## Resources

- **Deployment Guide:** `DEPLOYMENT_V3.md`
- **Architecture:** `CLAUDE.md`
- **Implementation Plan:** `ASSET_AWARE_IMPLEMENTATION_PLAN.md`
- **Test Scripts:**
  - `npm run test:v3-integration` - Integration tests
  - `npm run test:asset-security` - Security tests

---

## Support

- GitHub: https://github.com/[your-org]/xencat-light-client
- Issues: Create a GitHub issue with label `v3`
- Security: security@[your-domain].com

---

**Last Updated:** 2026-01-06
**Version:** 3.0.0
