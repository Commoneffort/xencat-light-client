/**
 * Ed25519 Program Instruction Builder
 *
 * This module creates Ed25519Program instructions for cryptographic signature verification.
 * These instructions are prepended to the main verify_proof transaction to enable
 * native Ed25519 verification on Solana/X1 at ~3,000 CU per signature.
 *
 * SECURITY: CRITICAL COMPONENT
 * - These instructions prove validators actually signed the block
 * - Without them, verification.rs will reject the proof
 * - Each validator signature gets its own Ed25519 instruction
 *
 * References:
 * - Solana Ed25519Program: https://docs.solana.com/developing/runtime-facilities/programs#ed25519-program
 * - Implementation: https://github.com/solana-labs/solana/blob/master/sdk/src/ed25519_instruction.rs
 */

import {
    PublicKey,
    TransactionInstruction,
    SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { createHash } from "crypto";

/**
 * Ed25519 Program ID (system program for signature verification)
 */
export const ED25519_PROGRAM_ID = new PublicKey(
    "Ed25519SigVerify111111111111111111111111111"
);

/**
 * Parameters for creating an Ed25519 verification instruction
 */
export interface Ed25519InstructionParams {
    /** Public key that signed the message (32 bytes) */
    publicKey: Uint8Array | Buffer;

    /** Message that was signed (32 bytes for our use case) */
    message: Uint8Array | Buffer;

    /** Ed25519 signature (64 bytes) */
    signature: Uint8Array | Buffer;
}

/**
 * Create an Ed25519 signature verification instruction
 *
 * Instruction Data Format:
 * - 1 byte: number of signatures (always 1 for us)
 * - 2 bytes: signature offset (where signature starts)
 * - 2 bytes: signature instruction index (0xFFFF = current instruction)
 * - 2 bytes: public key offset (where pubkey starts)
 * - 2 bytes: public key instruction index (0xFFFF = current instruction)
 * - 2 bytes: message offset (where message starts)
 * - 2 bytes: message length (32 bytes for our hash)
 * - 2 bytes: message instruction index (0xFFFF = current instruction)
 * - Then: signature (64 bytes) + pubkey (32 bytes) + message (variable)
 *
 * Total header: 13 bytes (1 + 2*6)
 * Total data: 13 + 64 + 32 + 32 = 141 bytes per instruction
 *
 * @param params Signature verification parameters
 * @returns TransactionInstruction for Ed25519Program
 */
export function createEd25519Instruction(
    params: Ed25519InstructionParams
): TransactionInstruction {
    const { publicKey, message, signature } = params;

    // Validate input sizes
    if (publicKey.length !== 32) {
        throw new Error(`Public key must be 32 bytes, got ${publicKey.length}`);
    }
    if (signature.length !== 64) {
        throw new Error(`Signature must be 64 bytes, got ${signature.length}`);
    }
    if (message.length !== 32) {
        throw new Error(`Message must be 32 bytes, got ${message.length}`);
    }

    // Build instruction data
    // Format: header (15 bytes) + signature (64) + pubkey (32) + message (32)
    // Header: 1 (num_sigs) + 2*7 (offsets and lengths) = 15 bytes
    const HEADER_SIZE = 15;
    const data = Buffer.alloc(HEADER_SIZE + 64 + 32 + 32);

    // Header
    let offset = 0;

    // Number of signatures (1 byte)
    data[offset] = 1;
    offset += 1;

    // Signature offset (2 bytes) - starts after header
    data.writeUInt16LE(HEADER_SIZE, offset);
    offset += 2;

    // Signature instruction index (2 bytes) - 0xFFFF means "this instruction"
    data.writeUInt16LE(0xFFFF, offset);
    offset += 2;

    // Public key offset (2 bytes) - starts after signature
    data.writeUInt16LE(HEADER_SIZE + 64, offset);
    offset += 2;

    // Public key instruction index (2 bytes) - 0xFFFF means "this instruction"
    data.writeUInt16LE(0xFFFF, offset);
    offset += 2;

    // Message offset (2 bytes) - starts after pubkey
    data.writeUInt16LE(HEADER_SIZE + 64 + 32, offset);
    offset += 2;

    // Message length (2 bytes)
    data.writeUInt16LE(32, offset);
    offset += 2;

    // Message instruction index (2 bytes) - 0xFFFF means "this instruction"
    data.writeUInt16LE(0xFFFF, offset);
    offset += 2;

    // Now offset should be HEADER_SIZE
    if (offset !== HEADER_SIZE) {
        throw new Error(`Header size mismatch: expected ${HEADER_SIZE}, got ${offset}`);
    }

    // Append signature (64 bytes)
    Buffer.from(signature).copy(data, offset);
    offset += 64;

    // Append public key (32 bytes)
    Buffer.from(publicKey).copy(data, offset);
    offset += 32;

    // Append message (32 bytes)
    Buffer.from(message).copy(data, offset);
    offset += 32;

    // Final size should be 143 bytes (15 + 64 + 32 + 32)
    if (offset !== 143) {
        throw new Error(`Data size mismatch: expected 143, got ${offset}`);
    }

    // Create instruction
    // Ed25519Program has no accounts, just data
    return new TransactionInstruction({
        programId: ED25519_PROGRAM_ID,
        keys: [],
        data,
    });
}

/**
 * Create the vote message that validators sign
 *
 * Message format: keccak256(blockHash || slot)
 *
 * This matches the verification.rs implementation in create_vote_message()
 *
 * @param blockHash Block hash (32 bytes)
 * @param slot Slot number
 * @returns 32-byte message hash
 */
export function createVoteMessage(blockHash: Uint8Array | Buffer, slot: bigint): Buffer {
    if (blockHash.length !== 32) {
        throw new Error(`Block hash must be 32 bytes, got ${blockHash.length}`);
    }

    // Concatenate blockHash || slot (little-endian)
    const messageData = Buffer.alloc(32 + 8);
    Buffer.from(blockHash).copy(messageData, 0);

    // Write slot as little-endian u64
    const slotBuffer = Buffer.alloc(8);
    slotBuffer.writeBigUInt64LE(slot);
    slotBuffer.copy(messageData, 32);

    // Hash with SHA256 (matches Rust's hash() function)
    // Note: Solana uses SHA256, not Keccak256 despite naming
    const hash = createHash("sha256").update(messageData).digest();

    return hash;
}

/**
 * Create Ed25519 instructions for all validator votes
 *
 * This creates one Ed25519Program instruction per validator.
 * These instructions MUST be prepended to the verify_proof instruction
 * in the exact order (validator 0, validator 1, validator 2, ...).
 *
 * Transaction structure:
 * [
 *   Ed25519(sig0, pubkey0, message),  // Index 0
 *   Ed25519(sig1, pubkey1, message),  // Index 1
 *   Ed25519(sig2, pubkey2, message),  // Index 2
 *   LightClient.verify_proof(proof),  // Index 3
 * ]
 *
 * @param validatorVotes Array of validator votes
 * @param blockHash Block hash that was signed
 * @param slot Slot number
 * @returns Array of Ed25519Program instructions (one per validator)
 */
export function createValidatorEd25519Instructions(
    validatorVotes: Array<{
        validatorIdentity: PublicKey;
        signature: Uint8Array;
        stake: bigint;
    }>,
    blockHash: Uint8Array,
    slot: bigint
): TransactionInstruction[] {
    // Create the vote message (what validators signed)
    const voteMessage = createVoteMessage(blockHash, slot);

    // Create one Ed25519 instruction per validator
    const instructions: TransactionInstruction[] = [];

    for (const vote of validatorVotes) {
        const ed25519Ix = createEd25519Instruction({
            publicKey: vote.validatorIdentity.toBytes(),
            message: voteMessage,
            signature: vote.signature,
        });

        instructions.push(ed25519Ix);
    }

    return instructions;
}

/**
 * Validate Ed25519 instruction structure
 *
 * Useful for testing and debugging
 *
 * @param instruction Ed25519 instruction to validate
 * @returns Validation result with details
 */
export function validateEd25519Instruction(instruction: TransactionInstruction): {
    valid: boolean;
    errors: string[];
    details?: {
        numSignatures: number;
        signatureOffset: number;
        pubkeyOffset: number;
        messageOffset: number;
        messageLength: number;
        totalSize: number;
    };
} {
    const errors: string[] = [];

    // Check program ID
    if (!instruction.programId.equals(ED25519_PROGRAM_ID)) {
        errors.push(`Invalid program ID: ${instruction.programId.toBase58()}`);
        return { valid: false, errors };
    }

    // Check minimum data size
    if (instruction.data.length < 13) {
        errors.push(`Data too small: ${instruction.data.length} bytes (minimum 13)`);
        return { valid: false, errors };
    }

    // Parse header
    const numSignatures = instruction.data[0];
    const signatureOffset = instruction.data.readUInt16LE(1);
    const pubkeyOffset = instruction.data.readUInt16LE(5);
    const messageOffset = instruction.data.readUInt16LE(9);
    const messageLength = instruction.data.readUInt16LE(11);

    // Validate structure
    if (numSignatures !== 1) {
        errors.push(`Expected 1 signature, got ${numSignatures}`);
    }

    if (signatureOffset !== 13) {
        errors.push(`Expected signature offset 13, got ${signatureOffset}`);
    }

    if (pubkeyOffset !== 13 + 64) {
        errors.push(`Expected pubkey offset 77, got ${pubkeyOffset}`);
    }

    if (messageOffset !== 13 + 64 + 32) {
        errors.push(`Expected message offset 109, got ${messageOffset}`);
    }

    if (messageLength !== 32) {
        errors.push(`Expected message length 32, got ${messageLength}`);
    }

    const expectedSize = 13 + 64 + 32 + 32;
    if (instruction.data.length !== expectedSize) {
        errors.push(`Expected data size 141 bytes, got ${instruction.data.length}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        details: {
            numSignatures,
            signatureOffset,
            pubkeyOffset,
            messageOffset,
            messageLength,
            totalSize: instruction.data.length,
        },
    };
}

/**
 * Calculate total transaction size including Ed25519 instructions
 *
 * Useful for ensuring we stay under the 1232 byte limit
 *
 * @param numValidators Number of validators (Ed25519 instructions)
 * @param verifyProofInstructionSize Size of the main verify_proof instruction
 * @returns Estimated transaction size in bytes
 */
export function estimateTransactionSize(
    numValidators: number,
    verifyProofInstructionSize: number
): {
    ed25519InstructionsSize: number;
    verifyProofSize: number;
    totalInstructionsSize: number;
    transactionOverhead: number;
    totalSize: number;
    withinLimit: boolean;
} {
    // Each Ed25519 instruction is 143 bytes of data (15 + 64 + 32 + 32) + overhead
    const ed25519InstructionDataSize = 143; // 15 (header) + 64 (sig) + 32 (pubkey) + 32 (msg)
    const ed25519InstructionOverhead = 10; // Program ID + keys length + data length field
    const singleEd25519Size = ed25519InstructionDataSize + ed25519InstructionOverhead;

    const ed25519InstructionsSize = singleEd25519Size * numValidators;

    // Transaction overhead (signatures, blockhash, etc.)
    const transactionOverhead = 150; // Approximate

    const totalSize =
        ed25519InstructionsSize +
        verifyProofInstructionSize +
        transactionOverhead;

    return {
        ed25519InstructionsSize,
        verifyProofSize: verifyProofInstructionSize,
        totalInstructionsSize: ed25519InstructionsSize + verifyProofInstructionSize,
        transactionOverhead,
        totalSize,
        withinLimit: totalSize <= 1232, // Solana's transaction size limit
    };
}
