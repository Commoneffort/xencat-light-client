#!/usr/bin/env ts-node
/**
 * Initialize Solana Light Client on X1 Testnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

async function initializeLightClient() {
    console.log("🚀 Initializing Solana Light Client on X1 Testnet\n");

    const validatorData = JSON.parse(fs.readFileSync('genesis-validators.json', 'utf8'));
    console.log(`✅ Loaded ${validatorData.validatorCount} validators\n`);

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const programId = new PublicKey("BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5");
    const idl = JSON.parse(fs.readFileSync('./target/idl/solana_light_client_x1.json', 'utf8'));
    const program = new Program(idl, programId, provider);

    const [lightClientState] = PublicKey.findProgramAddressSync(
        [Buffer.from("light_client_state")], programId
    );
    const [validatorSetAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("validator_set")], programId
    );
    const [validatorSetHistory] = PublicKey.findProgramAddressSync(
        [Buffer.from("validator_set_history")], programId
    );

    console.log(`Light Client State: ${lightClientState.toString()}\n`);

    const MAX_VALIDATORS = 20;
    const topValidators = validatorData.validators.slice(0, MAX_VALIDATORS);

    let initTotalStake = new anchor.BN(0);
    const validatorSet = topValidators.map((v: any) => {
        const stakeBN = new anchor.BN(v.stake.toString());
        initTotalStake = initTotalStake.add(stakeBN);
        return {
            identity: new PublicKey(v.identity),
            stake: stakeBN,
        };
    });

    console.log(`Initializing with ${validatorSet.length} validators...\n`);

    const tx = await program.methods
        .initialize({
            validatorSet: validatorSet,
            totalStake: initTotalStake,
        })
        .accounts({
            lightClientState,
            validatorSet: validatorSetAccount,
            validatorSetHistory,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    console.log(`✅ Initialized! TX: ${tx}\n`);
}

initializeLightClient().catch(console.error);
