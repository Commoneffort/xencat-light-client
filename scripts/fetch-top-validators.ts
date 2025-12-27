#!/usr/bin/env ts-node
/**
 * Fetch Top 7 Validators from Solana Mainnet
 *
 * This script fetches the current top validators by stake and prepares
 * them for light client initialization.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

interface ValidatorInfo {
    identity: string;
    voteAccount: string;
    stake: string; // Store as string to preserve large numbers
}

interface ValidatorData {
    timestamp: number;
    epoch: number;
    validatorCount: number;
    totalStake: string;
    top7Stake: string;
    stakePercentage: number;
    validators: ValidatorInfo[];
}

async function fetchTopValidators(count: number = 7): Promise<ValidatorData> {
    console.log('🔍 Fetching top validators from Solana mainnet...\n');

    const rpcUrl = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Get current epoch
    const epochInfo = await connection.getEpochInfo();
    console.log(`📊 Current epoch: ${epochInfo.epoch}`);
    console.log(`📍 Current slot: ${epochInfo.absoluteSlot}\n`);

    // Fetch all vote accounts
    console.log('⏳ Fetching all vote accounts...');
    const voteAccounts = await connection.getVoteAccounts();

    const allValidators = voteAccounts.current;
    console.log(`✅ Found ${allValidators.length} active validators\n`);

    // Calculate total stake
    const totalStake = allValidators.reduce((sum, v) => sum + BigInt(v.activatedStake), BigInt(0));
    console.log(`💰 Total active stake: ${Number(totalStake) / 1e9} SOL\n`);

    // Sort by stake (descending)
    const sortedValidators = [...allValidators].sort((a, b) =>
        Number(BigInt(b.activatedStake) - BigInt(a.activatedStake))
    );

    // Take top N
    const topValidators = sortedValidators.slice(0, count);

    console.log(`🏆 Top ${count} validators by stake:\n`);
    topValidators.forEach((v, i) => {
        const stakeSol = Number(BigInt(v.activatedStake)) / 1e9;
        const percentage = (Number(BigInt(v.activatedStake)) / Number(totalStake)) * 100;
        console.log(`${i + 1}. ${v.nodePubkey.slice(0, 8)}...`);
        console.log(`   Vote: ${v.votePubkey.slice(0, 8)}...`);
        console.log(`   Stake: ${stakeSol.toLocaleString()} SOL (${percentage.toFixed(2)}%)\n`);
    });

    // Calculate top 7 total stake
    const top7Stake = topValidators.reduce((sum, v) => sum + BigInt(v.activatedStake), BigInt(0));
    const stakePercentage = (Number(top7Stake) / Number(totalStake)) * 100;

    console.log(`📊 Top ${count} validators statistics:`);
    console.log(`   Combined stake: ${Number(top7Stake) / 1e9} SOL`);
    console.log(`   Percentage: ${stakePercentage.toFixed(2)}%`);
    console.log(`   Threshold: 15.00% (minimum required)`);

    if (stakePercentage >= 15) {
        console.log(`   ✅ PASSES 15% threshold!\n`);
    } else {
        console.log(`   ❌ FAILS 15% threshold! Need more validators.\n`);
    }

    // Format for JSON
    const validatorData: ValidatorData = {
        timestamp: Date.now(),
        epoch: epochInfo.epoch,
        validatorCount: topValidators.length,
        totalStake: totalStake.toString(),
        top7Stake: top7Stake.toString(),
        stakePercentage,
        validators: topValidators.map(v => ({
            identity: v.nodePubkey,
            voteAccount: v.votePubkey,
            stake: v.activatedStake.toString(),
        })),
    };

    return validatorData;
}

async function main() {
    try {
        const count = parseInt(process.argv[2]) || 7;

        console.log(`
╔════════════════════════════════════════════════════╗
║  FETCH TOP ${count} VALIDATORS FROM SOLANA MAINNET       ║
╚════════════════════════════════════════════════════╝
`);

        const validatorData = await fetchTopValidators(count);

        // Save to file
        const outputPath = './top-7-validators.json';
        fs.writeFileSync(outputPath, JSON.stringify(validatorData, null, 2));

        console.log(`✅ Saved to ${outputPath}\n`);

        // Show summary
        console.log('📋 Summary for deployment:');
        console.log(`   Validators: ${validatorData.validatorCount}`);
        console.log(`   Epoch: ${validatorData.epoch}`);
        console.log(`   Stake: ${validatorData.stakePercentage.toFixed(2)}%`);
        console.log(`   Status: ${validatorData.stakePercentage >= 15 ? '✅ READY' : '❌ NOT READY'}\n`);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
