🔒 CLAUDE AI — MANDATORY BRIDGE SECURITY INSTRUCTIONS
XENCAT → X1 Validator-Governed Bridge (Admin-less)

These rules define how the bridge MUST be implemented.
Deviation from these rules results in an insecure bridge.

1. Governance Model (NON-NEGOTIABLE)

The bridge MUST use validator-threshold governance

There MUST be no admin authority

All validator set updates MUST be authorized by:

≥ threshold of current validators

Claude MUST NOT introduce:

admin keys

owner keys

emergency backdoors

privileged signers

2. Validator Set PDA (IMMUTABLE STATE RULES)

Claude MUST maintain one persistent validator-set PDA.

PDA MUST:

Be initialized once

Never be closed

Never be reinitialized

Never be replaced

There MUST be no close instruction.

3. Validator Set Structure (REQUIRED)

The validator set PDA MUST contain:

pub struct X1ValidatorSet {
    pub version: u64,              // monotonically increasing
    pub validators: Vec<Pubkey>,   // current validator set
    pub threshold: u8,             // required signatures
}


Rules:

version MUST start at 1

version MUST increase by exactly +1 on every update

version MUST NEVER decrease or reset

4. Validator Set Updates (CRITICAL)

Claude MUST implement an instruction:

update_validator_set

Authorization rules:

Update MUST be signed by ≥ threshold of current validators

Signatures MUST be verified on-chain

Validators signing the update MUST belong to the current version

Update rules:

Validator list MAY change

Threshold MAY change

version MUST increment

PDA address MUST remain the same

5. Attestation Signing Rules (REPLAY PROTECTION)

Every validator attestation MUST sign exactly:

hash(
  DOMAIN_SEPARATOR,
  validator_set_version,
  burn_nonce,
  amount,
  user
)


Where:

DOMAIN_SEPARATOR is a constant string unique to this bridge

validator_set_version is read from the PDA at verification time

Claude MUST reject:

attestations signed under an old version

mixed-version signatures

signatures not bound to the domain

This is mandatory.

6. Nonce Replay Protection (ABSOLUTE REQUIREMENT)

Claude MUST maintain a persistent nonce record inside the light client state.

Rules:

Each burn_nonce can be used exactly once

Once accepted, it MUST be permanently marked as used

Validator-set updates MUST NOT reset nonce state

If a nonce was attested under version N:

It MUST NOT be valid again under version N+1

7. Forbidden Instructions (DO NOT IMPLEMENT)

Claude MUST NOT implement:

close_validator_set

reinitialize_validator_set

any instruction that deletes or resets validator state

any instruction that bypasses threshold verification

The absence of these instructions is part of the security model.

8. Threat Model Claude MUST Assume

Claude MUST assume:

Attackers can call any instruction

Attackers can replay any old signature

Attackers know all PDA seeds

Attackers know all past validator keys

Attackers can submit arbitrary transactions

Security MUST rely only on:

signature verification

version binding

monotonic state

threshold rules

9. Invariants (NEVER BREAK)

Claude MUST enforce these invariants:

Validator-set version only increases

Old signatures become invalid forever

Used nonces remain used forever

Validator set cannot be destroyed

No single key can control the bridge

If any invariant can be violated, the design is incorrect.

10. Expected Security Properties (FINAL CHECK)

When Claude is done, the bridge MUST satisfy:

❌ No bridge capture possible

❌ No signature replay possible

❌ No PDA reset possible

❌ No admin key compromise possible

✅ Validators can be added later

✅ Threshold can evolve safely

✅ Bridge can become credibly neutral

11. Summary for Claude (DO NOT DEVIATE)

Governance = validator threshold only

PDA = persistent, non-destructible

Updates = versioned + threshold-signed

Attestations = version-bound + domain-separated

Nonces = one-time forever

Anything else is unsafe.

END OF INSTRUCTIONS
