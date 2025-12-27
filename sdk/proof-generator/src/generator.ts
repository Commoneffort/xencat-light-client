/**
 * XENCAT Proof Generator SDK - MINIMAL PROOF APPROACH
 *
 * This generator creates cryptographically secure proofs that:
 * 1. Prove the burn transaction exists and is finalized
 * 2. Prove the exact burn data via Merkle proof
 * 3. Prevent amount manipulation and fake burns
 * 4. Select validators for finality proof (signatures provided via Ed25519 ixs)
 *
 * OPTIMIZATION: Validator data is NOT included in proof argument
 * Instead, it's extracted from Ed25519Program instructions in the transaction
 * This saves 312+ bytes and keeps TX1 under the 1232-byte limit
 *
 * SECURITY: All data comes from Solana RPC (public, trustless)
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
    BurnProof,
    BurnRecord,
    ValidatorVote,
    ProofGeneratorConfig,
    ProofStep,
    ProofGeneratorError,
    ProofErrorCode,
    ProofGenerationResult,
} from "./types";
import {
    fetchBurnRecord,
    waitForFinality,
    fetchBlockData,
    fetchValidators,
    sampleValidators,
    blockhashToBytes,
} from "./solana";
import { generateMerkleProof } from "./merkle";

/**
 * Generate a MINIMAL burn proof with Merkle verification
 *
 * Proof structure:
 * 1. Burn identification (nonce, user, amount)
 * 2. Block data (slot, block_hash, state_root)
 * 3. Merkle proof - PROVES burn data is exact and untampered
 * 4. Validator count - tells how many Ed25519 instructions to read
 *
 * OPTIMIZATION:
 * - Validator data extracted from Ed25519 instructions (not in proof)
 * - Saves 312+ bytes to fit in 1232-byte transaction limit
 *
 * SECURITY CRITICAL:
 * - Merkle proof prevents amount manipulation
 * - Merkle proof prevents fake burn records
 * - Ed25519 signatures ensure finality (verified by Ed25519Program)
 * - All data from public Solana RPC (trustless)
 */
export async function generateBurnProof(
    config: ProofGeneratorConfig
): Promise<ProofGenerationResult> {
    // Validate config
    validateConfig(config);

    const connection = new Connection(config.solanaRpc, {
        commitment: "finalized",
        confirmTransactionInitialTimeout: config.timeout || 30000,
    });

    const burnProgramId = new PublicKey(config.burnProgramId);
    const userPubkey = new PublicKey(config.userAddress);
    const validatorCount = config.validatorCount || 3; // Default to 3 for tx size
    const onProgress = config.onProgress || (() => {});

    try {
        // Step 1: Fetch burn record
        onProgress(ProofStep.FETCHING_BURN_RECORD, 0, "Fetching burn record...");
        const { record, slot: burnSlot, accountPubkey } = await fetchBurnRecord(
            connection,
            config.burnNonce,
            burnProgramId,
            config.maxRetries
        );
        onProgress(ProofStep.FETCHING_BURN_RECORD, 100, `Found at slot ${burnSlot}`);

        // SECURITY CHECK: Verify user matches
        if (!record.user.equals(userPubkey)) {
            throw new ProofGeneratorError(
                `Burn record user mismatch: expected ${userPubkey.toBase58()}, got ${record.user.toBase58()}`,
                ProofErrorCode.INVALID_BURN_DATA
            );
        }

        // Step 2: Find the burn transaction
        onProgress(ProofStep.FETCHING_TRANSACTION, 0, "Finding burn transaction...");
        const burnTxSignature = await findBurnTransactionForAccount(
            connection,
            accountPubkey,
            userPubkey
        );

        if (!burnTxSignature) {
            throw new ProofGeneratorError(
                `Burn transaction not found for nonce ${config.burnNonce}`,
                ProofErrorCode.TRANSACTION_NOT_FOUND
            );
        }

        onProgress(ProofStep.FETCHING_TRANSACTION, 100, `Found tx: ${burnTxSignature.substring(0, 8)}...`);

        // Step 3: Wait for finality
        onProgress(ProofStep.WAITING_FINALITY, 0, "Waiting for finality...");
        await waitForFinality(connection, burnSlot, (current, target) => {
            const progress = Math.min(100, ((current - burnSlot) / (target - burnSlot)) * 100);
            onProgress(ProofStep.WAITING_FINALITY, progress, `${current}/${target}`);
        });
        onProgress(ProofStep.WAITING_FINALITY, 100, "Finalized");

        // Step 4: Fetch burn record account data (for Merkle proof and proof data)
        // IMPORTANT: We use the ACTUAL on-chain data (without Anchor discriminator)
        // This ensures Rust deserialization works correctly
        const burnRecordAccount = await connection.getAccountInfo(accountPubkey, {
            commitment: "finalized",
        });

        if (!burnRecordAccount) {
            throw new ProofGeneratorError(
                "Burn record account not found",
                ProofErrorCode.BURN_NOT_FOUND
            );
        }

        // Extract burn record data (skip 8-byte Anchor discriminator)
        const burnRecordData = new Uint8Array(burnRecordAccount.data.slice(8));

        // Step 5: Generate Merkle proof (SECURITY CRITICAL)
        // IMPORTANT: Pass the burn record data so the Merkle tree
        // hashes the EXACT same data that will be sent in the proof
        onProgress(ProofStep.BUILDING_MERKLE_TREE, 0, "Building Merkle tree...");
        const merkleProof = await generateMerkleProof(
            connection,
            burnTxSignature,
            accountPubkey,
            burnRecordData
        );
        onProgress(ProofStep.BUILDING_MERKLE_TREE, 100, "Merkle tree built");

        // Step 5: Fetch block data
        onProgress(ProofStep.FETCHING_BLOCK_DATA, 0, "Fetching block data...");
        const blockData = await fetchBlockData(connection, burnSlot);
        const blockHash = blockhashToBytes(blockData.blockhash);
        onProgress(ProofStep.FETCHING_BLOCK_DATA, 100, "Block data fetched");

        // Step 6: Select top 7 validators that voted for burn slot
        onProgress(ProofStep.FETCHING_VALIDATORS, 0, "Selecting top 7 validators...");

        const { selectTopValidatorsForSlot } = await import("./solana");
        const { validators: selectedValidators, totalStake, selectedStake } = await selectTopValidatorsForSlot(
            connection,
            burnSlot,
            validatorCount
        );

        const stakePercent = Number((selectedStake * BigInt(100)) / totalStake);

        onProgress(ProofStep.FETCHING_VALIDATORS, 100, `${selectedValidators.length} validators (${stakePercent.toFixed(2)}% stake)`);

        // Step 7: Validator signatures will be provided via Ed25519 instructions
        // No need to include validator data in proof - it's extracted from Ed25519 ixs
        onProgress(ProofStep.COLLECTING_SIGNATURES, 0, "Validators selected...");
        onProgress(ProofStep.COLLECTING_SIGNATURES, 100, `${selectedValidators.length} validators`);

        // Step 8: Construct minimal proof
        onProgress(ProofStep.COMPLETE, 100, "Complete");

        const burnProof: BurnProof = {
            // Burn identification
            burnNonce: record.nonce,
            user: record.user,
            amount: record.amount,

            // Block data
            slot: BigInt(burnSlot),
            blockHash: new Uint8Array(blockHash),
            stateRoot: new Uint8Array(merkleProof.root),

            // Merkle proof (SECURITY CRITICAL)
            merkleProof: merkleProof.proof.map(p => new Uint8Array(p)),

            // Validator count (tells submit_proof how many Ed25519 ixs to read)
            validatorCount: selectedValidators.length,
        };

        // Return proof + validators (validators needed for building Ed25519 instructions)
        return {
            proof: burnProof,
            validators: selectedValidators,
        };
    } catch (error) {
        if (error instanceof ProofGeneratorError) {
            throw error;
        }

        throw new ProofGeneratorError(
            `Proof generation failed: ${error instanceof Error ? error.message : String(error)}`,
            ProofErrorCode.RPC_ERROR,
            { originalError: error }
        );
    }
}

/**
 * Find the burn transaction by getting signatures for the burn record account
 * This finds the transaction that created/modified the account
 */
async function findBurnTransactionForAccount(
    connection: Connection,
    accountPubkey: PublicKey,
    userPubkey: PublicKey
): Promise<string | null> {
    // Get the signatures for the burn record account
    // The first signature is the one that created the account (the burn transaction)
    const signatures = await connection.getSignaturesForAddress(
        accountPubkey,
        {
            limit: 10, // Should only be 1 signature (account is created once)
        },
        "finalized"
    );

    if (signatures.length === 0) {
        // Account has no transactions? Try user's transactions as fallback
        const userSigs = await connection.getSignaturesForAddress(
            userPubkey,
            {
                limit: 100,
            },
            "finalized"
        );

        // Return the most recent transaction (likely the burn)
        return userSigs.length > 0 ? userSigs[0].signature : null;
    }

    // Return the transaction that created the burn record
    // (should be the LAST/oldest one, but often there's only one)
    return signatures[signatures.length - 1].signature;
}

/**
 * Serialize burn record to match on-chain format
 */
function serializeBurnRecord(record: BurnRecord): Uint8Array {
    const buffer = new Uint8Array(57);
    const view = new DataView(buffer.buffer);

    let offset = 0;

    // nonce (u64)
    view.setBigUint64(offset, record.nonce, true);
    offset += 8;

    // user (Pubkey)
    buffer.set(record.user.toBytes(), offset);
    offset += 32;

    // amount (u64)
    view.setBigUint64(offset, record.amount, true);
    offset += 8;

    // timestamp (i64)
    view.setBigInt64(offset, record.timestamp, true);
    offset += 8;

    // target_chain (u8)
    view.setUint8(offset, record.targetChain);

    return buffer;
}

/**
 * Validate configuration
 */
function validateConfig(config: ProofGeneratorConfig): void {
    if (!config.solanaRpc) {
        throw new ProofGeneratorError("solanaRpc required", ProofErrorCode.INVALID_CONFIG);
    }

    if (!config.burnProgramId) {
        throw new ProofGeneratorError("burnProgramId required", ProofErrorCode.INVALID_CONFIG);
    }

    if (!config.userAddress) {
        throw new ProofGeneratorError("userAddress required", ProofErrorCode.INVALID_CONFIG);
    }

    if (config.burnNonce === undefined || config.burnNonce < 0) {
        throw new ProofGeneratorError("burnNonce must be non-negative", ProofErrorCode.INVALID_CONFIG);
    }

    // Validate public keys
    try {
        new PublicKey(config.burnProgramId);
        new PublicKey(config.userAddress);
    } catch {
        throw new ProofGeneratorError("Invalid public key", ProofErrorCode.INVALID_CONFIG);
    }

    // Validate URL
    try {
        new URL(config.solanaRpc);
    } catch {
        throw new ProofGeneratorError("Invalid RPC URL", ProofErrorCode.INVALID_CONFIG);
    }
}
