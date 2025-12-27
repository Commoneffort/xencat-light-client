/**
 * XENCAT Proof Generator SDK - Type Definitions
 * Browser-compatible TypeScript types matching Rust IDL
 */

import { PublicKey } from "@solana/web3.js";

/**
 * Burn proof structure - MINIMAL VERSION FOR TWO-TX FLOW
 * Must serialize to match programs/solana-light-client-x1/src/lib.rs BurnProof
 *
 * OPTIMIZATION: Validator data is extracted from Ed25519 instructions
 * This avoids duplicating 312 bytes of validator data in the proof argument
 *
 * Size: ~185 bytes (vs ~585 bytes with validator_votes included)
 */
export interface BurnProof {
    // Burn identification
    /** Unique nonce for this burn */
    burnNonce: bigint;
    /** User who burned tokens */
    user: PublicKey;
    /** Amount burned (in token base units) */
    amount: bigint;

    // Block data
    /** Solana slot where burn occurred */
    slot: bigint;
    /** Block hash of the burn block (32 bytes) */
    blockHash: Uint8Array;
    /** State root hash (32 bytes) - root of Merkle tree of transaction accounts */
    stateRoot: Uint8Array;

    // Merkle proof (SECURITY CRITICAL)
    /** Merkle proof path from burn record to state root */
    merkleProof: Uint8Array[];

    // Validator count (read this many Ed25519 instructions)
    /** Number of validators that signed (tells how many Ed25519 ixs to read) */
    validatorCount: number;
}

/**
 * Burn record from Solana burn contract
 * Internal type used during proof generation
 */
export interface BurnRecord {
    /** Unique nonce for this burn */
    nonce: bigint;
    /** User who burned tokens */
    user: PublicKey;
    /** Amount burned (in token base units, e.g., lamports) */
    amount: bigint;
    /** Timestamp of burn (Unix timestamp) */
    timestamp: bigint;
    /** Target chain ID (X1 = 1) */
    targetChain: number;
}

/**
 * Validator vote with signature (matches on-chain ValidatorVote)
 */
export interface ValidatorVote {
    /** Validator identity public key */
    validatorIdentity: PublicKey;
    /** Validator stake amount */
    stake: bigint;
    /** Ed25519 signature (64 bytes) */
    signature: Uint8Array;
}

/**
 * Configuration for proof generation
 */
export interface ProofGeneratorConfig {
    /** Solana RPC endpoint */
    solanaRpc: string;
    /** Burn nonce to generate proof for */
    burnNonce: number;
    /** Burn program ID on Solana */
    burnProgramId: string;
    /** User address who burned (to find transaction) */
    userAddress: string;
    /** Number of validator signatures to collect (default: 3) */
    validatorCount?: number;
    /** Maximum retries for RPC calls (default: 3) */
    maxRetries?: number;
    /** Retry delay in ms (default: 1000) */
    retryDelay?: number;
    /** Timeout for RPC calls in ms (default: 30000) */
    timeout?: number;
    /** Progress callback */
    onProgress?: (step: ProofStep, progress: number, message?: string) => void;
}

/**
 * Validator info from validator set
 */
export interface ValidatorInfo {
    /** Validator identity public key */
    identity: PublicKey;
    /** Validator stake (lamports) */
    stake: bigint;
    /** Validator vote account */
    voteAccount: PublicKey;
}

/**
 * Result of proof generation (includes proof + validators for Ed25519 instructions)
 */
export interface ProofGenerationResult {
    /** Minimal burn proof */
    proof: BurnProof;
    /** Selected validators (for building Ed25519 instructions) */
    validators: ValidatorInfo[];
}

/**
 * Progress steps for proof generation
 */
export enum ProofStep {
    FETCHING_BURN_RECORD = "FETCHING_BURN_RECORD",
    FETCHING_TRANSACTION = "FETCHING_TRANSACTION",
    WAITING_FINALITY = "WAITING_FINALITY",
    BUILDING_MERKLE_TREE = "BUILDING_MERKLE_TREE",
    GENERATING_MERKLE_PROOF = "GENERATING_MERKLE_PROOF",
    FETCHING_BLOCK_DATA = "FETCHING_BLOCK_DATA",
    FETCHING_VALIDATORS = "FETCHING_VALIDATORS",
    COLLECTING_SIGNATURES = "COLLECTING_SIGNATURES",
    COMPLETE = "COMPLETE",
}

/**
 * Error types
 */
export class ProofGeneratorError extends Error {
    constructor(
        message: string,
        public code: ProofErrorCode,
        public details?: any
    ) {
        super(message);
        this.name = "ProofGeneratorError";
    }
}

export enum ProofErrorCode {
    BURN_NOT_FOUND = "BURN_NOT_FOUND",
    BURN_NOT_FINALIZED = "BURN_NOT_FINALIZED",
    INVALID_BURN_DATA = "INVALID_BURN_DATA",
    TRANSACTION_NOT_FOUND = "TRANSACTION_NOT_FOUND",
    RPC_ERROR = "RPC_ERROR",
    INSUFFICIENT_VALIDATORS = "INSUFFICIENT_VALIDATORS",
    SIGNATURE_COLLECTION_FAILED = "SIGNATURE_COLLECTION_FAILED",
    TIMEOUT = "TIMEOUT",
    INVALID_CONFIG = "INVALID_CONFIG",
}
