/**
 * Initialize ValidatorConfig with Top 7 Solana Validators
 *
 * This script initializes the ValidatorConfig account with:
 * - 3 primary validators (highest stake)
 * - 4 fallback validators (validators 4-7 by stake)
 *
 * These validators will be used for proof verification.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { SolanaLightClientX1 } from "../target/types/solana_light_client_x1";
import fs from "fs";

// Constants
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const X1_RPC = "https://rpc.testnet.x1.xyz";
const LIGHT_CLIENT_PROGRAM_ID = new PublicKey("BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5");

interface ValidatorInfo {
    identity: PublicKey;
    stake: anchor.BN;
}

async function main() {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║   Initialize ValidatorConfig - Top 7 Validators           ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    // Setup X1 connection
    const x1Connection = new Connection(X1_RPC, "confirmed");
    const solanaConnection = new Connection(SOLANA_RPC, "confirmed");

    // Load wallet
    const wallet = anchor.AnchorProvider.env().wallet;
    const provider = new anchor.AnchorProvider(x1Connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    console.log(`Wallet: ${wallet.publicKey.toBase58()}\n`);

    // Load program
    const idl = JSON.parse(
        fs.readFileSync("target/idl/solana_light_client_x1.json", "utf-8")
    );
    const program = new Program(
        idl,
        LIGHT_CLIENT_PROGRAM_ID,
        provider
    ) as Program<SolanaLightClientX1>;

    // Step 1: Fetch top 7 validators from Solana
    console.log("📊 Fetching top validators from Solana mainnet...\n");

    const voteAccounts = await solanaConnection.getVoteAccounts();
    const allValidators = voteAccounts.current.concat(voteAccounts.delinquent);

    // Sort by activated stake (descending)
    const sortedValidators = allValidators
        .sort((a, b) => b.activatedStake - a.activatedStake)
        .slice(0, 7); // Top 7

    console.log("Top 7 Validators:\n");
    sortedValidators.forEach((v, i) => {
        console.log(`${i + 1}. ${v.nodePubkey}`);
        console.log(`   Stake: ${(v.activatedStake / 1e9).toFixed(2)} SOL`);
        console.log(`   Commission: ${v.commission}%\n`);
    });

    // Split into primary (top 3) and fallback (4-7)
    // Convert stake to string first to handle large numbers
    const primaryValidators: ValidatorInfo[] = sortedValidators
        .slice(0, 3)
        .map((v) => ({
            identity: new PublicKey(v.nodePubkey),
            stake: new anchor.BN(v.activatedStake.toString()),
        }));

    const fallbackValidators: ValidatorInfo[] = sortedValidators
        .slice(3, 7)
        .map((v) => ({
            identity: new PublicKey(v.nodePubkey),
            stake: new anchor.BN(v.activatedStake.toString()),
        }));

    // Calculate total stake
    const totalStake = sortedValidators.reduce(
        (sum, v) => sum + v.activatedStake,
        0
    );

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("Validator Configuration:");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("PRIMARY VALIDATORS (Top 3):");
    primaryValidators.forEach((v, i) => {
        console.log(`  ${i + 1}. ${v.identity.toBase58()}`);
        console.log(`     Stake: ${(parseFloat(v.stake.toString()) / 1e9).toFixed(2)} SOL`);
    });
    console.log("\nFALLBACK VALIDATORS (4-7):");
    fallbackValidators.forEach((v, i) => {
        console.log(`  ${i + 4}. ${v.identity.toBase58()}`);
        console.log(`     Stake: ${(parseFloat(v.stake.toString()) / 1e9).toFixed(2)} SOL`);
    });
    console.log(`\nTotal Tracked Stake: ${(totalStake / 1e9).toFixed(2)} SOL\n`);

    // Step 2: Derive ValidatorConfig PDA
    const [validatorConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("validator_config")],
        program.programId
    );

    const [lightClientStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("light_client_state")],
        program.programId
    );

    console.log("Program Accounts:");
    console.log(`  ValidatorConfig PDA: ${validatorConfigPda.toBase58()}`);
    console.log(`  LightClientState PDA: ${lightClientStatePda.toBase58()}\n`);

    // Step 3: Check if already initialized
    try {
        const configAccount = await program.account.validatorConfig.fetch(
            validatorConfigPda
        );
        console.log("⚠️  ValidatorConfig already initialized!");
        console.log(`   Current Epoch: ${configAccount.currentEpoch.toString()}`);
        console.log(
            `   Last Update: ${new Date(configAccount.lastUpdate.toNumber() * 1000).toISOString()}\n`
        );

        console.log("Do you want to rotate to new epoch? (This would be a rotation, not init)");
        console.log("If yes, use the rotate-validator-config script instead.\n");
        return;
    } catch (e) {
        // Account doesn't exist - proceed with initialization
        console.log("✓ ValidatorConfig not yet initialized. Proceeding...\n");
    }

    // Step 4: Get current epoch
    const epochInfo = await solanaConnection.getEpochInfo();
    const currentEpoch = epochInfo.epoch;

    console.log(`Current Solana Epoch: ${currentEpoch}\n`);

    // Step 5: Initialize ValidatorConfig
    console.log("🚀 Initializing ValidatorConfig...\n");

    try {
        const tx = await program.methods
            .initializeValidatorConfig(
                new anchor.BN(currentEpoch),
                primaryValidators,
                fallbackValidators
            )
            .accounts({
                validatorConfig: validatorConfigPda,
                lightClientState: lightClientStatePda,
                authority: wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        console.log("✅ ValidatorConfig Initialized!\n");
        console.log(`Transaction Signature: ${tx}\n`);

        // Verify
        const config = await program.account.validatorConfig.fetch(
            validatorConfigPda
        );

        console.log("═══════════════════════════════════════════════════════════");
        console.log("Verification:");
        console.log("═══════════════════════════════════════════════════════════\n");
        console.log(`Current Epoch: ${config.currentEpoch.toString()}`);
        console.log(`Total Tracked Stake: ${config.totalTrackedStake.toString()} lamports`);
        console.log(`Total Tracked Stake: ${(parseFloat(config.totalTrackedStake.toString()) / 1e9).toFixed(2)} SOL`);
        console.log(`\nPrimary Validators: ${config.primaryValidators.length}`);
        console.log(`Fallback Validators: ${config.fallbackValidators.length}`);

        console.log("\n✅ Initialization Complete!");
        console.log("\nNext Steps:");
        console.log("1. Test proof generation with these validators");
        console.log("2. Run E2E test to verify full flow");
        console.log("3. Monitor for validator rotation needs\n");
    } catch (error) {
        console.error("❌ Initialization failed:");
        console.error(error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
