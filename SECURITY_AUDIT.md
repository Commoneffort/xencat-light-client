# Security Review – Asset-Aware Bridge (V3)

**Project:** XENCAT / DGN Asset-Aware Bridge (V3)

**Date:** 2026-01-06

---

> ⚠️ **Disclaimer**
>
> This document represents an internal security review and architectural analysis performed by the project maintainers. It is **not** a third-party security audit and should not be interpreted as a formal certification or guarantee of security.
>
> While significant effort has been made to identify and mitigate critical risks, no software system can be considered completely free of vulnerabilities.

---

## 1. Executive Summary

This document provides a security review of the XENCAT  cross-chain bridge following the introduction of the **asset-aware V3 architecture**.

The V3 design explicitly binds burns, attestations, and mints to a specific asset identity, eliminating an entire class of vulnerabilities present in the earlier design. In particular, the new architecture prevents:

* Cross-asset minting
* Replay of attestations across assets
* Supply inflation via unrelated SPL token burns

Under the defined threat model, the bridge architecture is considered **production-ready**.

---

## 2. Scope of Review

### Components Reviewed

* Solana burn flows for XENCAT and DGN
* Validator attestation services (V3)
* X1 Light Client program (V3)
* XENCAT mint program (X1)
* DGN mint program (X1)

### Out of Scope

* Validator governance processes
* RPC availability and censorship resistance
* Frontend integrations and UX

---

## 3. Threat Model

### Assets at Risk

* XENCAT token supply on X1
* DGN token supply on X1
* Validator incentives and reputation
* User trust in 1:1 burn-to-mint guarantees

### Adversaries Considered

* Malicious users attempting unauthorized minting
* Replay attacks using valid burns of other assets
* Rogue or outdated validator services
* Malicious off-chain attestation services

---

## 4. Original Design Limitation (Addressed)

### Description

In the pre-V3 design, validators attested to the **existence of a burn**, but did not cryptographically bind the attestation to the **specific SPL mint** that was burned.

### Impact

* Burns of arbitrary SPL tokens could theoretically be used to mint XENCAT
* No cryptographic separation between different assets
* Potential unlimited supply inflation

### Severity

**Critical** (Supply integrity failure)

---

## 5. V3 Security Architecture

### 5.1 Asset Identification

Each supported asset is assigned a fixed `asset_id`:

| Asset  | Solana Mint     | asset_id |
| ------ | --------------- | -------- |
| XENCAT | XENCAT SPL Mint | 1        |
| DGN    | DGN SPL Mint    | 2        |

Validators derive the asset identity directly from the Solana burn transaction and map it to a canonical `asset_id`.

---

### 5.2 Cryptographic Binding

Validator signatures cover the following fields:

* `asset_id`
* `burn_nonce`
* `user`
* `amount`
* `source_chain`

As a result, attestations are **cryptographically bound** to a single asset and cannot be replayed across different mint programs.

---

### 5.3 PDA Namespace Separation

Verified burns are stored using asset-aware PDAs:

```
verified_burn_v3 = [
  "verified_burn_v3",
  asset_id,
  user,
  burn_nonce
]
```

This guarantees:

* No PDA collisions across assets
* Independent accounting per asset
* Safe reuse of nonces across different tokens

---

## 6. Mint Program Enforcement

### 6.1 XENCAT Mint Program

* Accepts only `asset_id == 1`
* Rejects all other assets with `AssetNotMintable`
* Verifies V3 burn PDAs
* Enforces single-use burns

### 6.2 DGN Mint Program

* Accepts only `asset_id == 2`
* Same enforcement logic as XENCAT

**Result:** Even with valid attestations, cross-asset minting is impossible.

---

## 7. Nonce Security Analysis

* Nonces act as **unique identifiers**, not counters
* Sequential ordering is not required
* Gaps in nonce values are permitted
* Duplicate usage is prevented via processed-burn PDAs

**Conclusion:** The nonce design does not introduce replay or ordering vulnerabilities.

---

## 8. Validator & Attestation Security

### Validator Requirements

Validators must:

* Detect the SPL mint from the Solana burn
* Map mint → correct `asset_id`
* Reject unknown or unsupported mints
* Sign asset-bound attestations
* Serve the `/attest-burn-v3` endpoint

Validators:

* Cannot mint tokens
* Cannot bypass on-chain enforcement

### Rogue Attestation Services

* Anyone may run an attestation service
* On-chain programs only accept signatures from validators in the active set
* Asset mismatches are rejected on-chain

**Result:** Rogue services pose no protocol-level risk.

---

## 9. Authority & Upgrade Risk

### Mint Authority

* Mint authority is transferred to a program-derived address (PDA)
* No externally owned account retains mint power

### Program Upgrade Authority

* Upgrade authority may be revoked to make programs immutable
* No CPI-based upgrade paths exist

---

## 10. Testing Performed

### End-to-End Tests

* ✅ XENCAT burn → XENCAT mint
* ❌ DGN burn → XENCAT mint (rejected)
* ✅ DGN burn → DGN mint
* ❌ Unknown SPL mint (rejected)
* ❌ Duplicate burn (rejected)
* ✅ Same nonce, different assets (accepted)

All tests passed successfully on mainnet.

---

## 11. Residual Risks

| Risk                | Status                        |
| ------------------- | ----------------------------- |
| Validator collusion | Economic / governance risk    |
| Chain reorgs        | Mitigated via finality checks |
| RPC censorship      | Out of scope                  |

No unresolved **technical** vulnerabilities were identified within scope.

---

## 12. Conclusion

The asset-aware V3 architecture materially improves the security of the bridge and fully addresses the previously identified supply inflation risk.

Under the documented threat model and assumptions, the bridge is considered **robust and production-ready**, with a scalable foundation for future multi-asset support.

---

**Prepared by:** XENCAT / X1 Core Contributors
