# V2 → V3 Migration Checklist

This checklist helps existing integrations migrate from V2 to V3.

---

## Decision: Do You Need to Migrate?

### You Can Stay on V2 If:

- ✅ You only use XENCAT (no other assets)
- ✅ Your integration works fine
- ✅ You don't need asset-aware features
- ✅ V2 path meets your requirements

**V2 will remain supported for backward compatibility.**

### You Should Migrate to V3 If:

- You want explicit asset validation
- You want to support multiple assets (XENCAT, DGN, etc.)
- You want to future-proof your integration
- You want the latest security features

---

## Migration Options

### Option 1: Gradual Migration (Recommended)

Deploy V3 alongside V2, migrate users gradually:

1. Add V3 support to your app
2. Keep V2 as fallback
3. Migrate users over time
4. Deprecate V2 when ready

### Option 2: Hard Cutover

Switch entirely to V3:

1. Test V3 thoroughly
2. Update all endpoints
3. Deploy new version
4. No backward compatibility

### Option 3: Stay on V2

Continue using V2:

1. No changes needed
2. V2 remains functional
3. Miss out on new features

---

## Migration Steps (Option 1: Gradual)

### Phase 1: Testing (Week 1)

- [ ] Read V3 documentation:
  - [ ] `V3_QUICK_REFERENCE.md`
  - [ ] `DEPLOYMENT_V3.md`
  - [ ] `examples/v3-complete-flow.ts`

- [ ] Set up test environment:
  - [ ] Test wallet with XNT
  - [ ] Access to test XENCAT burns
  - [ ] X1 RPC endpoint configured

- [ ] Test V3 flow end-to-end:
  - [ ] Burn XENCAT on Solana
  - [ ] Collect V3 attestations
  - [ ] Submit to light client
  - [ ] Mint on X1

- [ ] Verify backward compatibility:
  - [ ] Test existing V2 flow still works
  - [ ] Test V2 and V3 PDAs don't collide
  - [ ] Test concurrent usage

### Phase 2: Code Updates (Week 2)

#### Update 1: Add V3 Attestation Collection

**Before (V2):**
```typescript
const attestations = await collectAttestations(burnNonce, user, amount);
```

**After (V3):**
```typescript
// Option A: Only V3
const attestations = await collectAttestationsV3(burnNonce, user, amount);

// Option B: Try V3, fallback to V2
let attestations;
try {
    attestations = await collectAttestationsV3(burnNonce, user, amount);
} catch (err) {
    console.log('V3 failed, falling back to V2');
    attestations = await collectAttestationsV2(burnNonce, user, amount);
}
```

**Checklist:**
- [ ] Update validator request endpoint to `/attest-burn-v3`
- [ ] Handle `asset_id` in response
- [ ] Handle unknown mint errors
- [ ] Add fallback to V2 (if gradual migration)

---

#### Update 2: Add V3 PDA Derivation

**Before (V2):**
```typescript
const [verifiedBurn] = PublicKey.findProgramAddressSync(
    [
        Buffer.from('verified_burn_v2'),
        user.toBuffer(),
        burnNonce.toBuffer(),
    ],
    lightClientProgram
);
```

**After (V3):**
```typescript
const assetId = 1; // XENCAT

const [verifiedBurn] = PublicKey.findProgramAddressSync(
    [
        Buffer.from('verified_burn_v3'),
        Buffer.from([assetId]),  // ✅ NEW
        user.toBuffer(),
        Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
    ],
    lightClientProgram
);
```

**Checklist:**
- [ ] Add `asset_id` to PDA seeds
- [ ] Use correct seed order
- [ ] Use `.to_le_bytes()` for numeric seeds
- [ ] Test PDA derivation matches on-chain

---

#### Update 3: Update Light Client Call

**Before (V2):**
```typescript
await program.methods
    .submitBurnAttestation(attestationData)
    .accounts({ user, validatorSet, verifiedBurn, systemProgram })
    .rpc();
```

**After (V3):**
```typescript
const assetId = 1; // XENCAT

await program.methods
    .submitBurnAttestationV3(assetId, burnNonce, attestationData)  // ✅ NEW params
    .accounts({ user, validatorSet, verifiedBurn, systemProgram })
    .rpc();
```

**Checklist:**
- [ ] Use `submitBurnAttestationV3` instruction
- [ ] Pass `asset_id` and `burn_nonce` as separate params
- [ ] Update `attestationData` structure to include `asset_id`
- [ ] Verify account list is correct

---

#### Update 4: Update Mint Call

**Before (V2):**
```typescript
await program.methods
    .mintFromBurn(burnNonce)
    .accounts({
        mintState,
        xencatMint,
        processedBurn,
        userTokenAccount,
        user,
        validatorSet,
        verifiedBurn,
        tokenProgram,
        systemProgram,
    })
    .remainingAccounts(validators)
    .rpc();
```

**After (V3):**
```typescript
const assetId = 1; // XENCAT

await program.methods
    .mintFromBurnV3(burnNonce, assetId)  // ✅ NEW param
    .accounts({
        mintState,
        xencatMint,
        processedBurn,      // ✅ Now uses V3 PDA
        userTokenAccount,
        user,
        validatorSet,
        verifiedBurn,       // ✅ Now uses V3 PDA
        tokenProgram,
        systemProgram,
    })
    .remainingAccounts(validators)
    .rpc();
```

**Checklist:**
- [ ] Use `mintFromBurnV3` instruction
- [ ] Pass `asset_id` as second parameter
- [ ] Update `processedBurn` PDA to V3 format
- [ ] Update `verifiedBurn` PDA to V3 format
- [ ] Test minting works correctly

---

### Phase 3: Deployment (Week 3)

- [ ] Deploy to staging:
  - [ ] Test with real burns
  - [ ] Verify all flows work
  - [ ] Test error handling

- [ ] Gradual rollout:
  - [ ] 10% of users on V3
  - [ ] Monitor for errors
  - [ ] Fix issues

- [ ] Full rollout:
  - [ ] 100% of users on V3
  - [ ] Monitor metrics
  - [ ] Keep V2 as fallback

### Phase 4: Cleanup (Week 4+)

- [ ] Remove V2 fallback code (after 30 days)
- [ ] Update documentation
- [ ] Deprecate V2 endpoints
- [ ] Celebrate! 🎉

---

## Common Migration Issues

### Issue 1: Validators Return 404

**Symptom:**
```
Error: Validator returned 404: Not found
```

**Cause:** Validator not updated to V3

**Solution:**
- Check if validator is running V3 service
- Try different validator
- Fall back to V2 if needed

---

### Issue 2: PDA Derivation Mismatch

**Symptom:**
```
Error: Account not found (PDA mismatch)
```

**Cause:** Incorrect PDA seeds

**Solution:**
```typescript
// WRONG
Buffer.from([assetId])  // May not work in all contexts

// CORRECT
Buffer.from([1])  // For XENCAT
// OR
assetId.to_le_bytes().as_ref()  // In Rust
```

---

### Issue 3: InvalidAttestation Error

**Symptom:**
```
Error: InvalidAttestation
```

**Cause:** Mismatch between parameters and attestation data

**Solution:**
```typescript
// Ensure these match:
const assetId = 1;
const attestationData = {
    assetId: 1,  // ✅ Must match
    burnNonce: 12345,
    // ...
};

await program.methods.submitBurnAttestationV3(
    assetId,  // ✅ Must match attestationData.assetId
    burnNonce,
    attestationData
);
```

---

### Issue 4: AssetNotMintable Error

**Symptom:**
```
Error: AssetNotMintable
```

**Cause:** Trying to mint non-XENCAT asset

**Solution:**
This is expected! XENCAT mint program only accepts `asset_id == 1`.
For other assets (like DGN), use their dedicated mint programs.

---

## Testing Checklist

Before considering migration complete:

### Functional Tests

- [ ] Can collect V3 attestations
- [ ] Can submit attestations to light client
- [ ] Can mint tokens on X1
- [ ] Fees distributed correctly
- [ ] V2 still works (if keeping backward compatibility)

### Security Tests

- [ ] DGN burn rejected (if testable)
- [ ] Unknown mint rejected
- [ ] Invalid asset_id rejected
- [ ] Cross-asset replay blocked

### Performance Tests

- [ ] Transaction latency acceptable
- [ ] Gas costs reasonable
- [ ] Validator response times good

### Error Handling

- [ ] Insufficient attestations handled
- [ ] Validator downtime handled
- [ ] Invalid data rejected
- [ ] User errors show helpful messages

---

## Rollback Plan

If migration fails:

### Step 1: Stop V3 Usage

```typescript
// In your app config
const USE_V3 = false;  // Disable V3

if (USE_V3) {
    // V3 flow
} else {
    // V2 flow (fallback)
}
```

### Step 2: Alert Users

- Notify users of the issue
- Explain fallback to V2
- Provide status updates

### Step 3: Investigate

- Check validator logs
- Check on-chain transactions
- Identify root cause

### Step 4: Fix and Retry

- Fix the issue
- Test thoroughly
- Re-enable V3 gradually

---

## Support

If you encounter issues during migration:

1. **Check documentation:**
   - `V3_QUICK_REFERENCE.md`
   - `DEPLOYMENT_V3.md`
   - `examples/v3-complete-flow.ts`

2. **Test with example code:**
   - Run `examples/v3-complete-flow.ts`
   - Compare with your implementation

3. **Ask for help:**
   - GitHub Issues: [link]
   - Discord: [link]
   - Email: [link]

---

## Success Metrics

Track these metrics during migration:

- [ ] V3 usage percentage
- [ ] V3 success rate (>99%)
- [ ] V3 vs V2 performance comparison
- [ ] Error rate (should be <1%)
- [ ] User feedback (should be positive)

---

**Good luck with your migration! 🚀**

Remember: V2 remains supported, so you can migrate at your own pace.
