#!/usr/bin/env ts-node
/**
 * Initialize Solana Light Client with Top 7 Validators
 *
 * This script initializes the light client on X1 testnet with
 * the current top 7 validators by stake from Solana mainnet.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

async function initializeLightClient() {
    console.log(`
╔════════════════════════════════════════════════════╗
║  INITIALIZE LIGHT CLIENT - 7 VALIDATORS           ║
╚════════════════════════════════════════════════════╝
`);

    // Load validator data
    const validatorFile = process.argv[2] || './top-7-validators.json';

    if (!fs.existsSync(validatorFile)) {
        console.error(`❌ Validator file not found: ${validatorFile}`);
        console.log('\n💡 Run this first:');
        console.log('   ts-node scripts/fetch-top-validators.ts\n');
        process.exit(1);
    }

    const validatorData = JSON.parse(fs.readFileSync(validatorFile, 'utf8'));

    console.log('📊 Validator Data:');
    console.log(`   Epoch: ${validatorData.epoch}`);
    console.log(`   Validators: ${validatorData.validatorCount}`);
    console.log(`   Stake: ${validatorData.stakePercentage.toFixed(2)}%`);
    console.log(`   Threshold: 15.00% (minimum)\n`);

    if (validatorData.stakePercentage < 15) {
        console.error('❌ Insufficient stake! Need at least 15%');
        console.log(`   Current: ${validatorData.stakePercentage.toFixed(2)}%`);
        console.log(`   Missing: ${(15 - validatorData.stakePercentage).toFixed(2)}%\n`);
        process.exit(1);
    }

    console.log('✅ Stake check passed!\n');

    // Setup provider
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const programId = new PublicKey("BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5");

    // Load IDL
    const idlPath = './target/idl/solana_light_client_x1.json';
    if (!fs.existsSync(idlPath)) {
        console.error(`❌ IDL not found: ${idlPath}`);
        console.log('\n💡 Build first: anchor build\n');
        process.exit(1);
    }

    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    const program = new Program(idl, programId, provider);

    // Derive PDAs
    const [lightClientState] = PublicKey.findProgramAddressSync(
        [Buffer.from("light_client_state")],
        programId
    );

    const [validatorSetAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("validator_set")],
        programId
    );

    const [validatorSetHistory] = PublicKey.findProgramAddressSync(
        [Buffer.from("validator_set_history")],
        programId
    );

    console.log('📍 Program Accounts:');
    console.log(`   Program ID: ${programId.toString()}`);
    console.log(`   Light Client State: ${lightClientState.toString()}`);
    console.log(`   Validator Set: ${validatorSetAccount.toString()}`);
    console.log(`   History: ${validatorSetHistory.toString()}\n`);

    // Check if already initialized
    try {
        const existingState: any = await program.account.lightClientState.fetch(lightClientState);
        console.log('⚠️  Light client already initialized!');
        console.log(`   Validators: ${existingState.validatorCount}`);
        console.log(`   Total stake: ${existingState.totalStake.toString()}`);
        console.log(`   Last update: ${existingState.lastUpdateSlot.toString()}\n`);

        const answer = await promptUser('Reinitialize? (yes/no): ');
        if (answer.toLowerCase() !== 'yes') {
            console.log('❌ Cancelled\n');
            process.exit(0);
        }
    } catch (error) {
        // Not initialized yet, proceed
        console.log('✅ Light client not initialized, proceeding...\n');
    }

    // Prepare validator set
    let totalStake = new anchor.BN(0);
    const validatorSet = validatorData.validators.map((v: any) => {
        const stakeBN = new anchor.BN(v.stake);
        totalStake = totalStake.add(stakeBN);
        return {
            identity: new PublicKey(v.identity),
            stake: stakeBN,
        };
    });

    console.log('🏗️  Initializing light client...\n');
    console.log('📋 Initialization parameters:');
    console.log(`   Validators: ${validatorSet.length}`);
    console.log(`   Total stake: ${totalStake.toString()}`);
    console.log(`   Authority: ${provider.wallet.publicKey.toString()}\n`);

    // Initialize
    try {
        const tx = await program.methods
            .initialize({
                validatorSet: validatorSet,
                totalStake: totalStake,
            })
            .accounts({
                lightClientState,
                validatorSet: validatorSetAccount,
                validatorSetHistory,
                authority: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log('✅ Light client initialized!\n');
        console.log(`📝 Transaction: ${tx}\n`);

        // Verify initialization
        const state: any = await program.account.lightClientState.fetch(lightClientState);
        console.log('🔍 Verification:');
        console.log(`   ✅ Validator count: ${state.validatorCount}`);
        console.log(`   ✅ Total stake: ${state.totalStake.toString()}`);
        console.log(`   ✅ Authority: ${state.authority.toString()}`);
        console.log(`   ✅ Fee receiver: ${state.feeReceiver.toString()}`);
        console.log(`   ✅ Verification fee: ${state.verificationFee.toString()} lamports\n`);

        console.log('🎉 Light client successfully initialized with 7 validators!\n');

    } catch (error: any) {
        console.error('❌ Initialization failed:', error.message);

        if (error.logs) {
            console.log('\n📋 Program logs:');
            error.logs.forEach((log: string) => console.log(`   ${log}`));
        }

        process.exit(1);
    }
}

function promptUser(question: string): Promise<string> {
    return new Promise((resolve) => {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        readline.question(question, (answer: string) => {
            readline.close();
            resolve(answer);
        });
    });
}

initializeLightClient().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
