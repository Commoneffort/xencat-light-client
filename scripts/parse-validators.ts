#!/usr/bin/env ts-node
/**
 * Parse Solana validator set from JSON output
 *
 * This script processes the output of `solana validators --output json`
 * and prepares it for light client initialization.
 */

import * as fs from 'fs';
import { PublicKey } from '@solana/web3.js';

interface SolanaValidator {
    identityPubkey: string;
    voteAccountPubkey: string;
    activatedStake: number;
    commission: number;
    lastVote: number;
    rootSlot: number;
    credits: number;
    epochCredits: number;
    version: string;
    delinquent?: boolean;
}

interface ValidatorData {
    epoch: number;
    validators: {
        identity: string;
        voteAccount: string;
        stake: number;
    }[];
    totalStake: number;
    validatorCount: number;
}

async function parseValidators() {
    console.log("📊 Parsing Solana validator set...\n");

    // Read the JSON file
    const rawData = fs.readFileSync('solana-validators.json', 'utf8');
    const data = JSON.parse(rawData);

    console.log(`Total Active Stake: ${(data.totalActiveStake / 1e9).toFixed(2)} SOL`);
    console.log(`Total Current Stake: ${(data.totalCurrentStake / 1e9).toFixed(2)} SOL`);
    console.log(`Total Delinquent Stake: ${(data.totalDelinquentStake / 1e9).toFixed(2)} SOL`);
    console.log(`Total Validators: ${data.validators?.length || 0}\n`);

    // Filter and process current validators only (not delinquent)
    const validators = (data.validators || [])
        .filter((v: SolanaValidator) => {
            // Only include validators with active stake and not delinquent
            return v.activatedStake > 0 && !v.delinquent;
        })
        .map((v: SolanaValidator) => ({
            identity: v.identityPubkey,
            voteAccount: v.voteAccountPubkey,
            stake: v.activatedStake,
        }))
        .sort((a: any, b: any) => b.stake - a.stake); // Sort by stake descending

    // Calculate total stake
    const totalStake = validators.reduce((sum: number, v: any) => sum + v.stake, 0);

    console.log(`✅ Filtered Validators: ${validators.length}`);
    console.log(`📊 Total Active Stake: ${(totalStake / 1e9).toFixed(2)} SOL`);
    console.log(`   (${totalStake} lamports)\n`);

    // Show top 10 validators by stake
    console.log("🏆 Top 10 Validators by Stake:");
    console.log("─".repeat(80));
    validators.slice(0, 10).forEach((v: any, i: number) => {
        const stakePercent = ((v.stake / totalStake) * 100).toFixed(2);
        const stakeSol = (v.stake / 1e9).toFixed(2);
        console.log(`${(i + 1).toString().padStart(2)}. ${v.identity.substring(0, 44)} ${stakeSol.padStart(12)} SOL (${stakePercent.padStart(5)}%)`);
    });
    console.log("─".repeat(80));

    // Calculate consensus threshold (66%+)
    const consensusThreshold = Math.ceil((totalStake * 2) / 3);
    console.log(`\n🔒 BFT Consensus Threshold (66%+): ${(consensusThreshold / 1e9).toFixed(2)} SOL`);
    console.log(`   (${consensusThreshold} lamports)\n`);

    // Prepare output data
    const outputData: ValidatorData = {
        epoch: 888, // Current epoch from epoch-info
        validators: validators,
        totalStake: totalStake,
        validatorCount: validators.length,
    };

    // Save for initialization
    fs.writeFileSync('genesis-validators.json', JSON.stringify(outputData, null, 2));

    console.log("✅ Saved to genesis-validators.json");
    console.log(`\n📋 Summary:`);
    console.log(`   - Epoch: ${outputData.epoch}`);
    console.log(`   - Validators: ${outputData.validatorCount}`);
    console.log(`   - Total Stake: ${(outputData.totalStake / 1e9).toFixed(2)} SOL`);
    console.log(`   - Consensus Threshold: ${(consensusThreshold / 1e9).toFixed(2)} SOL (66%+)`);

    // Validate all public keys are valid
    console.log(`\n🔍 Validating public keys...`);
    let invalidKeys = 0;
    for (const validator of validators) {
        try {
            new PublicKey(validator.identity);
            new PublicKey(validator.voteAccount);
        } catch (e) {
            console.log(`❌ Invalid key for validator: ${validator.identity}`);
            invalidKeys++;
        }
    }

    if (invalidKeys === 0) {
        console.log(`✅ All ${validators.length} validator keys are valid\n`);
    } else {
        console.log(`⚠️  Found ${invalidKeys} invalid keys\n`);
    }

    console.log("🎯 Next steps:");
    console.log("   1. Review genesis-validators.json");
    console.log("   2. Run: ts-node scripts/init-light-client.ts");
    console.log("   3. This will initialize the light client with this validator set\n");

    return outputData;
}

// Run if executed directly
if (require.main === module) {
    parseValidators()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("Error:", error);
            process.exit(1);
        });
}

export { parseValidators, ValidatorData };
