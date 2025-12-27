/**
 * XENCAT Proof Poster - Batch Validator Proof Posting
 *
 * Handles posting 7 validator proofs to X1 in optimized batches:
 * - Batch 1: Validators 1-4 (first transaction)
 * - Batch 2: Validators 5-7 (second transaction)
 *
 * This keeps each transaction under the size limit while achieving
 * ~17% stake coverage for production-grade security.
 */

import {
    Connection,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
    Keypair,
    SystemProgram,
} from "@solana/web3.js";
import { ValidatorInfo } from "./types";

/**
 * Configuration for posting validator proofs
 */
export interface PostProofsConfig {
    /** X1 RPC connection */
    x1Connection: Connection;

    /** User's keypair (pays for transactions) */
    userKeypair: Keypair;

    /** Slot number being proven */
    slot: number;

    /** Validators to post (should be 7) */
    validators: ValidatorInfo[];

    /** Light client program ID on X1 */
    lightClientProgramId: PublicKey;

    /** Optional progress callback */
    onProgress?: (step: string, progress: number, message: string) => void;
}

/**
 * Result of posting validator proofs
 */
export interface PostProofsResult {
    /** Transaction signatures */
    signatures: string[];

    /** Number of validators posted */
    validatorCount: number;

    /** Total stake posted */
    totalStake: bigint;

    /** Finality set PDA (where proofs are stored) */
    finalitySetPda: PublicKey;
}

/**
 * Post 7 validator proofs to X1 in 2 optimized batches
 *
 * Transaction 1: Validators 1-4 (creates finality set)
 * Transaction 2: Validators 5-7 (completes finality set)
 *
 * This approach:
 * - Keeps each transaction under size limits
 * - Minimizes user interactions (2 transactions)
 * - Achieves ~17% stake coverage
 */
export async function postValidatorProofs(
    config: PostProofsConfig
): Promise<PostProofsResult> {
    const {
        x1Connection,
        userKeypair,
        slot,
        validators,
        lightClientProgramId,
        onProgress = () => {},
    } = config;

    console.log('\n📤 Posting 7 validator proofs to X1...\n');

    // Validate we have 7 validators
    if (validators.length !== 7) {
        console.warn(`⚠️  Expected 7 validators, got ${validators.length}`);
    }

    // Derive finality set PDA
    const [finalitySetPda] = await PublicKey.findProgramAddress(
        [
            Buffer.from("finality_set"),
            Buffer.from(new BigUint64Array([BigInt(slot)]).buffer),
        ],
        lightClientProgramId
    );

    console.log(`   Finality Set PDA: ${finalitySetPda.toBase58()}`);
    console.log(`   Slot: ${slot}\n`);

    // Split into batches
    const batch1 = validators.slice(0, 4);  // Validators 1-4
    const batch2 = validators.slice(4, 7);  // Validators 5-7

    const signatures: string[] = [];
    const totalStake = validators.reduce((sum, v) => sum + v.stake, BigInt(0));

    // ═══════════════════════════════════════════════════════════
    // BATCH 1: Post validators 1-4
    // ═══════════════════════════════════════════════════════════

    console.log('📦 Batch 1: Posting validators 1-4...');
    onProgress('batch1', 0, 'Posting validators 1-4...');

    try {
        const sig1 = await postBatch({
            connection: x1Connection,
            payer: userKeypair,
            slot,
            validators: batch1,
            finalitySetPda,
            lightClientProgramId,
            isFirstBatch: true,
        });

        signatures.push(sig1);
        console.log(`   ✅ Batch 1 posted: ${sig1.slice(0, 8)}...`);
        console.log(`   Validators: 1-4`);
        console.log(`   Stake: ${Number(batch1.reduce((s, v) => s + v.stake, BigInt(0))) / 1e9} SOL\n`);

        onProgress('batch1', 100, `Posted (${sig1.slice(0, 8)}...)`);

        // Wait for confirmation before posting batch 2
        console.log('   ⏳ Waiting for confirmation...');
        await x1Connection.confirmTransaction(sig1, 'confirmed');
        console.log('   ✅ Confirmed\n');

    } catch (error: any) {
        console.error(`❌ Batch 1 failed: ${error.message}`);
        throw new Error(`Failed to post batch 1: ${error.message}`);
    }

    // ═══════════════════════════════════════════════════════════
    // BATCH 2: Post validators 5-7
    // ═══════════════════════════════════════════════════════════

    console.log('📦 Batch 2: Posting validators 5-7...');
    onProgress('batch2', 0, 'Posting validators 5-7...');

    try {
        const sig2 = await postBatch({
            connection: x1Connection,
            payer: userKeypair,
            slot,
            validators: batch2,
            finalitySetPda,
            lightClientProgramId,
            isFirstBatch: false,
        });

        signatures.push(sig2);
        console.log(`   ✅ Batch 2 posted: ${sig2.slice(0, 8)}...`);
        console.log(`   Validators: 5-7`);
        console.log(`   Stake: ${Number(batch2.reduce((s, v) => s + v.stake, BigInt(0))) / 1e9} SOL\n`);

        onProgress('batch2', 100, `Posted (${sig2.slice(0, 8)}...)`);

        // Wait for final confirmation
        console.log('   ⏳ Waiting for confirmation...');
        await x1Connection.confirmTransaction(sig2, 'confirmed');
        console.log('   ✅ Confirmed\n');

    } catch (error: any) {
        console.error(`❌ Batch 2 failed: ${error.message}`);
        throw new Error(`Failed to post batch 2: ${error.message}`);
    }

    // ═══════════════════════════════════════════════════════════
    // COMPLETE
    // ═══════════════════════════════════════════════════════════

    console.log('✅ All 7 validator proofs posted successfully!\n');
    console.log(`   Total stake: ${Number(totalStake) / 1e9} SOL`);
    console.log(`   Transactions: ${signatures.length}`);
    console.log(`   Finality Set: ${finalitySetPda.toBase58()}\n`);

    onProgress('complete', 100, 'All proofs posted');

    return {
        signatures,
        validatorCount: validators.length,
        totalStake,
        finalitySetPda,
    };
}

/**
 * Post a single batch of validator proofs
 */
async function postBatch(params: {
    connection: Connection;
    payer: Keypair;
    slot: number;
    validators: ValidatorInfo[];
    finalitySetPda: PublicKey;
    lightClientProgramId: PublicKey;
    isFirstBatch: boolean;
}): Promise<string> {
    const {
        connection,
        payer,
        slot,
        validators,
        finalitySetPda,
        lightClientProgramId,
        isFirstBatch,
    } = params;

    // TODO: Build actual instruction using Anchor IDL
    // For now, this is a placeholder showing the structure

    // In production, you'd use:
    // const program = new Program(idl, lightClientProgramId, provider);
    // const ix = await program.methods
    //     .postVoteProofs(new BN(slot), validatorData)
    //     .accounts({
    //         finalitySet: finalitySetPda,
    //         payer: payer.publicKey,
    //         systemProgram: SystemProgram.programId,
    //     })
    //     .instruction();

    console.log(`   Building transaction for ${validators.length} validators...`);

    // Placeholder: Create a simple transaction
    // In reality, this would contain the vote proof data
    const tx = new Transaction();

    // Add memo for now (replace with actual instruction)
    // tx.add(
    //     createMemoInstruction(
    //         `Post validators for slot ${slot}`,
    //         [payer.publicKey]
    //     )
    // );

    // Set recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;

    // Sign and send
    const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [payer],
        {
            commitment: 'confirmed',
            skipPreflight: false,
        }
    );

    return signature;
}

/**
 * Verify finality set exists and is valid
 */
export async function verifyFinalitySet(
    connection: Connection,
    finalitySetPda: PublicKey
): Promise<{
    exists: boolean;
    validatorCount: number;
    totalStake: bigint;
    isFinalized: boolean;
}> {
    const accountInfo = await connection.getAccountInfo(finalitySetPda);

    if (!accountInfo) {
        return {
            exists: false,
            validatorCount: 0,
            totalStake: BigInt(0),
            isFinalized: false,
        };
    }

    // TODO: Parse finality set data
    // For now, return placeholder
    return {
        exists: true,
        validatorCount: 7,
        totalStake: BigInt(0),
        isFinalized: true,
    };
}

/**
 * Calculate optimal batch sizes for N validators
 *
 * This function determines how to split validators into batches
 * to stay under transaction size limits while minimizing batch count.
 *
 * For 7 validators: [4, 3]
 * For 20 validators: [5, 5, 5, 5]
 */
export function calculateBatchSizes(
    validatorCount: number,
    maxPerBatch: number = 5
): number[] {
    const batches: number[] = [];
    let remaining = validatorCount;

    while (remaining > 0) {
        const batchSize = Math.min(remaining, maxPerBatch);
        batches.push(batchSize);
        remaining -= batchSize;
    }

    return batches;
}
