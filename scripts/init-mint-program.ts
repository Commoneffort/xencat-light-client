#!/usr/bin/env ts-node
/**
 * Initialize XENCAT Mint Program on X1 Testnet
 *
 * This creates:
 * - MintState PDA (program state)
 * - XENCAT token mint (SPL token)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";

async function initializeMintProgram() {
    console.log("🚀 Initializing XENCAT Mint Program on X1 Testnet");
    console.log("=" . repeat(80) + "\n");

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const programId = new PublicKey("8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk");
    const idl = JSON.parse(fs.readFileSync('./target/idl/xencat_mint_x1.json', 'utf8'));
    const program = new Program(idl, programId, provider);

    console.log("🔗 Connection Details:");
    console.log(`   RPC: ${provider.connection.rpcEndpoint}`);
    console.log(`   Program: ${programId.toString()}`);
    console.log(`   Authority: ${provider.wallet.publicKey.toString()}\n`);

    // Derive PDAs
    const [mintState] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_state")],
        programId
    );

    const [xencatMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("xencat_mint")],
        programId
    );

    console.log("📍 Program Derived Addresses (PDAs):");
    console.log(`   Mint State: ${mintState.toString()}`);
    console.log(`   XENCAT Mint: ${xencatMint.toString()}\n`);

    // Check if already initialized
    try {
        const state: any = await program.account.mintState.fetch(mintState);
        console.log("⚠️  Mint program already initialized!");
        console.log(`   Authority: ${state.authority.toString()}`);
        console.log(`   XENCAT Mint: ${state.xencatMint.toString()}`);
        console.log(`   Mint Fee: ${state.mintFee.toString()} lamports`);
        console.log(`   Total Minted: ${state.totalMinted.toString()}`);
        console.log(`   Processed Burns: ${state.processedBurnsCount.toString()}\n`);
        return;
    } catch (e) {
        console.log("✅ Mint program not yet initialized. Proceeding...\n");
    }

    // Initialize
    console.log("🔄 Sending initialization transaction...");
    console.log("   This will create:");
    console.log("   1. MintState PDA (program state)");
    console.log("   2. XENCAT Token Mint (SPL token, 6 decimals)");
    console.log("   3. Set mint authority to MintState PDA");
    console.log("   4. Set fee to 0.001 XNT\n");

    try {
        const tx = await program.methods
            .initialize()
            .accounts({
                mintState,
                xencatMint,
                authority: provider.wallet.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        console.log("✅ Mint program initialized successfully!");
        console.log(`   Transaction: ${tx}\n`);
        console.log(`   Explorer: https://explorer.x1.xyz/tx/${tx}?cluster=testnet\n`);

        // Fetch and display state
        const state: any = await program.account.mintState.fetch(mintState);

        console.log("📊 Mint Program State:");
        console.log("─".repeat(80));
        console.log(`   Authority: ${state.authority.toString()}`);
        console.log(`   XENCAT Mint: ${state.xencatMint.toString()}`);
        console.log(`   Fee Receiver: ${state.feeReceiver.toString()}`);
        console.log(`   Mint Fee: ${state.mintFee.toString()} lamports (${state.mintFee.toNumber() / 1e6} XNT)`);
        console.log(`   Total Minted: ${state.totalMinted.toString()}`);
        console.log(`   Processed Burns Count: ${state.processedBurnsCount.toString()}`);
        console.log(`   Bump: ${state.bump}`);
        console.log("─".repeat(80));

        console.log("\n✅ Initialization Complete!\n");
        console.log("🎯 Next Steps:");
        console.log("   1. ✅ Light client initialized with validators");
        console.log("   2. ✅ Mint program initialized with XENCAT token");
        console.log("   3. Create end-to-end test with burn proof");
        console.log("   4. Test minting tokens from Solana burn\n");

        // Save initialization info
        const initInfo = {
            timestamp: new Date().toISOString(),
            network: "X1 Testnet",
            programId: programId.toString(),
            mintState: mintState.toString(),
            xencatMint: xencatMint.toString(),
            transaction: tx,
            authority: state.authority.toString(),
            mintFee: state.mintFee.toString(),
        };

        fs.writeFileSync(
            'mint-program-init.json',
            JSON.stringify(initInfo, null, 2)
        );
        console.log("💾 Saved initialization info to mint-program-init.json\n");

    } catch (error: any) {
        console.error("❌ Initialization failed!");
        console.error(`   Error: ${error.message}`);

        if (error.logs) {
            console.error("\n📜 Transaction Logs:");
            error.logs.forEach((log: string) => console.error(`   ${log}`));
        }

        throw error;
    }
}

if (require.main === module) {
    initializeMintProgram()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("\n❌ Fatal Error:", error);
            process.exit(1);
        });
}

export { initializeMintProgram };
