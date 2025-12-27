/**
 * Solana Vote State Parser
 *
 * Parses vote account data to extract validator voting information.
 * This allows us to verify which slots validators have voted for.
 *
 * Reference: https://github.com/solana-labs/solana/blob/master/sdk/program/src/vote/state/mod.rs
 */

import { PublicKey } from '@solana/web3.js';

/**
 * Represents a validator's vote lockout on a specific slot
 */
export interface Lockout {
    /** The slot that was voted on */
    slot: number;
    /** How many confirmations (votes on descendant slots) this vote has received */
    confirmationCount: number;
}

/**
 * Parsed vote account state
 */
export interface VoteState {
    /** The validator's identity public key */
    nodePubkey: PublicKey;

    /** Authorized withdrawer */
    authorizedWithdrawer: PublicKey;

    /** Commission percentage (0-100) */
    commission: number;

    /** List of votes with lockouts */
    votes: Lockout[];

    /** The most recent rooted slot (finalized) */
    rootSlot: number | null;

    /** Prior voters (for node upgrades) */
    priorVoters: Array<{
        pubkey: PublicKey;
        epochStart: number;
        epochEnd: number;
    }>;

    /** Epoch credits earned by this validator */
    epochCredits: Array<{
        epoch: number;
        credits: number;
        previousCredits: number;
    }>;
}

/**
 * Parse Solana vote account data
 *
 * Vote account structure (simplified):
 * - 4 bytes: version
 * - 32 bytes: node_pubkey
 * - 32 bytes: authorized_withdrawer
 * - 1 byte: commission
 * - Vec<Lockout>: votes
 * - Option<u64>: root_slot
 * - Vec<(Pubkey, u64, u64)>: prior_voters
 * - Vec<(u64, u64, u64)>: epoch_credits
 */
export function parseVoteState(data: Buffer): VoteState {
    let offset = 0;

    // Read version (4 bytes)
    const version = data.readUInt32LE(offset);
    offset += 4;

    if (version !== 1 && version !== 2) {
        throw new Error(`Unsupported vote state version: ${version}`);
    }

    // Read node pubkey (32 bytes)
    const nodePubkey = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Read authorized withdrawer (32 bytes)
    const authorizedWithdrawer = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Read commission (1 byte)
    const commission = data.readUInt8(offset);
    offset += 1;

    // Read votes Vec<Lockout>
    const votesLen = data.readUInt32LE(offset);
    offset += 4;

    const votes: Lockout[] = [];
    for (let i = 0; i < votesLen; i++) {
        // Each Lockout is 12 bytes: slot (u64) + confirmation_count (u32)
        const slot = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const confirmationCount = data.readUInt32LE(offset);
        offset += 4;

        votes.push({ slot, confirmationCount });
    }

    // Read root slot Option<u64>
    const hasRoot = data.readUInt8(offset);
    offset += 1;

    let rootSlot: number | null = null;
    if (hasRoot === 1) {
        rootSlot = Number(data.readBigUInt64LE(offset));
        offset += 8;
    }

    // Read prior voters (for completeness, though we don't need them)
    const priorVotersLen = data.readUInt32LE(offset);
    offset += 4;

    const priorVoters: Array<{ pubkey: PublicKey; epochStart: number; epochEnd: number }> = [];
    for (let i = 0; i < priorVotersLen; i++) {
        const pubkey = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;

        const epochStart = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const epochEnd = Number(data.readBigUInt64LE(offset));
        offset += 8;

        priorVoters.push({ pubkey, epochStart, epochEnd });
    }

    // Read epoch credits
    const epochCreditsLen = data.readUInt32LE(offset);
    offset += 4;

    const epochCredits: Array<{ epoch: number; credits: number; previousCredits: number }> = [];
    for (let i = 0; i < epochCreditsLen; i++) {
        const epoch = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const credits = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const previousCredits = Number(data.readBigUInt64LE(offset));
        offset += 8;

        epochCredits.push({ epoch, credits, previousCredits });
    }

    return {
        nodePubkey,
        authorizedWithdrawer,
        commission,
        votes,
        rootSlot,
        priorVoters,
        epochCredits,
    };
}

/**
 * Check if a validator has voted for a specific slot
 */
export function hasVotedForSlot(voteState: VoteState, targetSlot: number): boolean {
    return voteState.votes.some(vote => vote.slot === targetSlot);
}

/**
 * Get the most recent voted slot
 */
export function getLatestVotedSlot(voteState: VoteState): number | null {
    if (voteState.votes.length === 0) {
        return null;
    }

    return Math.max(...voteState.votes.map(v => v.slot));
}

/**
 * Check if a slot has been rooted (finalized) by this validator
 */
export function isSlotRooted(voteState: VoteState, targetSlot: number): boolean {
    if (voteState.rootSlot === null) {
        return false;
    }

    return targetSlot <= voteState.rootSlot;
}
