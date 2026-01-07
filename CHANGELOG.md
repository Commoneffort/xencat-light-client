# Changelog

All notable changes to the XENCAT Light Client Bridge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v3.0.0] - 2026-01-07 - Asset-Aware Bridge Upgrade

### Added

#### Core V3 Features
- Asset-aware attestation model with cryptographic asset binding
- Multi-asset support (XENCAT, DGN) with isolated mint programs
- Asset-specific PDAs (`verified_burn_v3`, `processed_burn_v3`)
- DGN mint program (`programs/dgn-mint-x1/`)
- New V3 instructions (`submit_burn_attestation_v3`, `mint_from_burn_v3`)
- Asset ID enforcement at validator, light client, and mint program layers

#### Security Enhancements
- Cryptographic binding of attestations to specific `asset_id`
- PDA namespace separation prevents cross-asset replay attacks
- Validator whitelist (XENCAT and DGN SPL mints only)
- On-chain asset validation in mint programs
- Asset-specific mint authority isolation

#### Testing & Documentation
- 250+ comprehensive security tests (V3 asset isolation tests)
- Asset-aware E2E test suite (`scripts/test-dgn-e2e.ts`, `scripts/test-v3-integration.ts`)
- Security testing for cross-asset replay prevention
- V3 implementation documentation (`V3_IMPLEMENTATION_SUMMARY.md`, `DEPLOYMENT_V3.md`)
- Internal security audit (`SECURITY_AUDIT.md`)

#### Developer Experience
- Universal bridge-mint script (`scripts/bridge-mint.ts`)
- Asset-specific deployment scripts
- DGN token metadata creation
- Comprehensive migration checklist

### Changed
- Light client state upgraded to `VerifiedBurnV3` (includes `asset_id`)
- Mint programs now use `ProcessedBurnV3` (includes `asset_id`)
- Validator attestation service updated to V3 (`index-v3-asset-aware.ts`)
- Attestation signature format includes `asset_id` in message hash

### Security
- **Addressed**: Supply inflation risk via unauthorized asset minting
- **Prevention**: Cross-asset replay attacks now cryptographically impossible
- **Enforcement**: Asset validation at 4 layers (validator, signature, light client, mint program)
- **Isolation**: Independent mint programs per asset with dedicated PDAs

### Backward Compatibility
- V2 instructions preserved for XENCAT (no breaking changes for existing users)
- Existing XENCAT burns and mints continue to work
- No action required for XENCAT holders

### Migration Notes
- No changes required for existing XENCAT holders
- V2 flows remain operational for XENCAT
- New burns should use V3 for enhanced security
- DGN requires V3 flows only

---

## [v2.0.0] - 2025-12-XX - Fee Distribution Upgrade

### Added
- Validator fee distribution system (0.01 XNT per validator)
- Dynamic validator set support
- Version-bound fee distribution
- Non-custodial instant fee payments

### Changed
- Fee model: Single receiver → Multi-validator distribution
- Mint authority transferred from V1 to V2
- Fee payment via `system_instruction::transfer` (XNT native token)

### Security
- 25 V2 migration security tests (100% pass rate)
- Replay protection across V1/V2
- Validator set version binding

---

## [v1.0.0] - 2025-11-XX - Initial Release

### Added
- Trustless validator attestation model
- Byzantine fault tolerance (3-of-5 threshold)
- Ed25519 signature verification
- Domain-separated signatures
- Version-bound attestations
- Replay protection via nonce tracking
- XENCAT bridging (Solana → X1)

### Security
- 242+ comprehensive security tests
- Fuzzing, invariant, and Byzantine conflict testing
- Format validation for Ed25519 signatures
- Finality enforcement (32-slot waiting period)

---

[v3.0.0]: https://github.com/yourusername/xencat-light-client/releases/tag/v3.0.0
[v2.0.0]: https://github.com/yourusername/xencat-light-client/releases/tag/v2.0.0
[v1.0.0]: https://github.com/yourusername/xencat-light-client/releases/tag/v1.0.0
