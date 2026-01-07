# Asset-Aware Attestation & Secure Multi-Asset Bridge Design

**Date**: 2026-01-05
**Authoritative Spec for Implementation**

---

## 0. Objective (Non-Negotiable)

Fix a critical vulnerability where any SPL token burn on Solana can be attested and used to mint XENCAT on X1, by making attestations asset-aware, while:

- Preserving all existing XENCAT mints
- Preserving nonce semantics
- Making the system cryptographically safe
- Enabling future assets (starting with Degen / DGN)

---

## 1. Core Security Invariant

**For each asset A:**
```
Total minted supply of A on X1 ≤ total burned supply of A on Solana
```

This invariant MUST hold permanently.

---

## 2. Tokens & Asset Registry (Authoritative)

### Solana SPL Tokens

| Asset | Name | Ticker | Mint Address |
|-------|------|--------|--------------|
| XENCAT | XENCAT | XENCAT | `7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V` |
| DGN | Degen | DGN | `Fd8TNp5GhhTk6Uq6utMvK13vfQdLN1yUUHCnapWvpump` |

### Asset IDs (Fixed, Stable)

```typescript
enum Asset {
  XENCAT = 1,
  DGN = 2,
}
```

- `asset_id` is `u8` everywhere
- Asset IDs are never inferred
- Asset IDs are explicit inputs
- Asset IDs are part of cryptographic hashing

---

## 3. What Is Broken Today (Summary)

### Current Flow (Vulnerable)

```
1. User burns ANY SPL token on Solana
2. Burn program creates BurnRecord (no token_mint stored)
3. Validators fetch BurnRecord by nonce
4. Validators verify: user, amount, finality
5. Validators sign hash(DOMAIN || version || nonce || amount || user)
6. X1 creates VerifiedBurn PDA
7. XENCAT mint program mints XENCAT
```

🚨 **Problem**:
Steps 1–4 never verify which token was burned.

**Result**:
- Any SPL burn → valid attestation → XENCAT mint
- Unlimited XENCAT inflation possible

---

## 4. High-Level Fix (Correct Layer)

**DO NOT change:**
- Solana burn program
- Nonce logic
- Existing XENCAT mint or authority
- Existing minted balances

**DO fix:**
- Validator attestation logic
- Proof namespacing
- Mint-side enforcement

---

## 5. New Secure Flow (Asset-Aware)

```
1. User burns SPL token on Solana
2. Burn program creates BurnRecord (unchanged)
3. Validator fetches burn TRANSACTION
4. Validator extracts SPL Burn instruction
5. Validator extracts burned mint address
6. Validator maps mint → asset_id
7. Validator rejects unknown assets
8. Validator signs hash(DOMAIN || asset_id || version || nonce || amount || user)
9. X1 stores VerifiedBurnV3 PDA scoped by asset_id
10. Mint program:
    - Requires correct asset_id
    - Uses asset-scoped PDA
    - Mints only the correct token
```

---

## 6. Validator Attestation Service Changes (MANDATORY)

### File
`validator-attestation-service/index.ts`

### New Responsibilities

#### 6.1 Detect Burned SPL Mint

**Implement:**
```typescript
detectBurnedMint(burnNonce) → { asset_id, mint }
```

**Must:**
- Fetch the burn transaction
- Parse inner instructions
- Locate exactly one SPL Token Burn
- Require SPL Token Program ID:
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

**Reject:**
- No burn
- Multiple burns
- Token-2022 burns (unless explicitly added later)

#### 6.2 Asset Registry Enforcement

```typescript
const ASSET_BY_MINT = {
  XENCAT_MINT: Asset.XENCAT,
  DGN_MINT: Asset.DGN,
};
```

- Unknown mint → hard reject
- No default asset
- No fallback

#### 6.3 Asset-Aware Attestation Hash

**Old (insecure):**
```
hash(DOMAIN || version || nonce || amount || user)
```

**New (secure):**
```
hash(DOMAIN || asset_id || version || nonce || amount || user)
```

This ensures:
- No cross-asset replay
- No signature reuse
- Cryptographic isolation

#### 6.4 Attestation Response Format

```json
{
  "asset_id": 1,
  "burn_nonce": 123,
  "user": "...",
  "amount": 1000,
  "validator_set_version": 1,
  "validator_pubkey": "...",
  "signature": "...",
  "timestamp": 1234567890
}
```

---

## 7. Light Client Program (X1) Changes

### New State (Additive)

```rust
pub struct VerifiedBurnV3 {
    pub asset_id: u8,
    pub burn_nonce: u64,
    pub user: Pubkey,
    pub amount: u64,
    pub verified_at: i64,
    pub processed: bool,
    pub bump: u8,
}
```

### PDA Seeds (Asset-Scoped)

**VerifiedBurnV3:**
```
["verified_burn_v3", asset_id, user, nonce]
```

**Important:**
`user` remains part of the PDA to preserve replay protection and prevent cross-user reuse.

### Legacy Support (DO NOT REMOVE)

Legacy PDAs remain valid for XENCAT only:

**VerifiedBurnV2:**
```
["verified_burn_v2", user, nonce]
```

**Implicit rule:**
Any V2 burn is treated as `asset_id = XENCAT`

---

## 8. XENCAT Mint Program Changes (CRITICAL)

### File
`programs/xencat-mint-x1/src/instructions/mint_from_burn.rs`

### Required Rules

1. Instruction MUST receive `asset_id`
2. Enforce:
   ```rust
   require!(asset_id == ASSET_XENCAT, InvalidAsset);
   ```
3. Derive PDA using `asset_id`
4. Try V3 first
5. Fallback to V2 only if `asset_id == XENCAT`

### Mint Logic (Exact Semantics)

```rust
if let Ok(v3) = load_verified_burn_v3(asset_id, user, nonce) {
    mint_from_v3(v3);
} else if asset_id == ASSET_XENCAT {
    let v2 = load_verified_burn_v2(user, nonce)?;
    mint_from_v2(v2);
} else {
    return Err(InvalidProof);
}
```

---

## 9. Nonce Semantics (DO NOT CHANGE)

- Nonces are global
- Nonces are not sequential
- Gaps are allowed
- Nonces are identifiers only

Asset separation is done via:
- `asset_id`
- Hashing
- PDA namespacing

---

## 10. Testing Requirements (MANDATORY)

### Must Pass

- ✅ `xencat_burn_mints_xencat`
- ❌ `dgn_burn_cannot_mint_xencat`
- ❌ `unknown_mint_is_rejected`
- ❌ `cross_asset_replay_fails`
- ❌ `wrong_asset_id_signature_fails`
- ✅ `legacy_xencat_v2_still_works`
- ✅ `nonces_with_gaps_are_accepted`
- ✅ `v2_and_v3_pdas_can_coexist`

---

## 11. Backward Compatibility Guarantees

- All existing XENCAT burns remain valid
- All existing XENCAT balances remain unchanged
- No migration required
- No nonce reset
- No authority changes

---

## 12. Future Assets (Explicit Design Goal)

Adding a new asset later must require ONLY:

1. Add `mint → asset_id` mapping
2. Deploy a new mint program (optional)

**No:**
- Protocol redesign
- Nonce changes
- Breaking upgrades

---

## 13. Definition of Done

The implementation is complete when:

- ✅ XENCAT supply on X1 is provably ≤ XENCAT burned on Solana
- ✅ DGN burns cannot mint XENCAT
- ✅ Unknown SPL tokens are rejected
- ✅ Cross-asset replay is cryptographically impossible
- ✅ All tests pass
- ✅ All validators are updated

---

**Status**: ✅ Final, implementation-ready
**Next Step**: Begin validator attestation changes (Section 6)
