#!/usr/bin/env ts-node
/**
 * Initialize XENCAT Mint Program on X1 Testnet
 * Uses raw instruction to bypass IDL parsing issues
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";

async function initializeMintProgram() {
    console.log("🚀 Initializing XENCAT Mint Program on X1 Testnet");
    console.log("=".repeat(80) + "\n");

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const programId = new PublicKey("8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk");

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

    // Check if already initialized by trying to fetch account data
    try {
        const accountInfo = await provider.connection.getAccountInfo(mintState);
        if (accountInfo && accountInfo.data.length > 0) {
            console.log("⚠️  Mint program already initialized!");
            console.log(`   Mint State account exists with ${accountInfo.data.length} bytes\n`);
            return;
        }
    } catch (e) {
        console.log("✅ Mint program not yet initialized. Proceeding...\n");
    }

    // Initialize instruction discriminator (first 8 bytes of SHA256("global:initialize"))
    const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

    console.log("🔄 Sending initialization transaction...");
    console.log("   This will create:");
    console.log("   1. MintState PDA (program state)");
    console.log("   2. XENCAT Token Mint (SPL token, 6 decimals)");
    console.log("   3. Set mint authority to MintState PDA");
    console.log("   4. Set fee to 0.001 XNT\n");

    try {
        const keys = [
            { pubkey: mintState, isSigner: false, isWritable: true },
            { pubkey: xencatMint, isSigner: false, isWritable: true },
            { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ];

        const ix = new TransactionInstruction({
            keys,
            programId,
            data: discriminator,
        });

        const tx = new anchor.web3.Transaction().add(ix);
        const txSig = await provider.sendAndConfirm(tx);

        console.log("✅ Mint program initialized successfully!");
        console.log(`   Transaction: ${txSig}\n`);
        console.log(`   Explorer: https://explorer.x1.xyz/tx/${txSig}?cluster=testnet\n`);

        // Wait a bit for the transaction to be confirmed
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Fetch and display state
        const stateAccount = await provider.connection.getAccountInfo(mintState);
        if (stateAccount) {
            console.log("📊 Mint Program State:");
            console.log("─".repeat(80));
            console.log(`   Mint State: ${mintState.toString()}`);
            console.log(`   XENCAT Mint: ${xencatMint.toString()}`);
            console.log(`   Account Size: ${stateAccount.data.length} bytes`);
            console.log("─".repeat(80));
        }

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
            transaction: txSig,
            authority: provider.wallet.publicKey.toString(),
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
