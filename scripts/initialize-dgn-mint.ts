/**
 * Initialize DGN mint program on X1
 * 1. Initialize mint state PDA
 * 2. Transfer mint authority to mint state PDA
 */

import 'dotenv/config';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { setAuthority, AuthorityType } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';

const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';

// Program IDs
const DGN_MINT_PROGRAM = new PublicKey('4YPipW8txxY3N7gHdj4NLhu8YxybHgarx5dJQCdCnQHs');
const LIGHT_CLIENT_PROGRAM = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
const DGN_MINT = new PublicKey('84PxDRsNyiRJU4gfFiD7RqvZzqh5FdqXjDdtFV3N3oxc');

async function main() {
    console.log('🔧 Initializing DGN Mint Program\n');

    // Load authority keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY environment variable required!');
    }

    let authority: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        authority = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        authority = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`👤 Authority: ${authority.publicKey.toBase58()}`);
    console.log(`🪙 DGN Mint: ${DGN_MINT.toBase58()}`);
    console.log(`📝 DGN Mint Program: ${DGN_MINT_PROGRAM.toBase58()}\n`);

    const connection = new Connection(X1_RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
        commitment: 'confirmed',
    });

    const idl = JSON.parse(
        fs.readFileSync('target/idl/dgn_mint_x1.json', 'utf-8')
    );

    const program = new anchor.Program(idl, DGN_MINT_PROGRAM, provider);

    // Derive mint state PDA
    const [mintStatePda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('dgn_mint_state')],
        DGN_MINT_PROGRAM
    );

    console.log(`🔑 Mint State PDA: ${mintStatePda.toBase58()}`);
    console.log(`   Bump: ${bump}\n`);

    // Check if already initialized
    try {
        const mintState: any = await program.account.mintState.fetch(mintStatePda);
        console.log('⚠️  DGN mint program already initialized!');
        console.log(`   Authority: ${mintState.authority.toBase58()}`);
        console.log(`   DGN Mint: ${mintState.dgnMint.toBase58()}`);
        console.log(`   Validator set version: ${mintState.validatorSetVersion.toString()}`);
        return;
    } catch (err) {
        // Not initialized, continue
        console.log('📤 Initializing mint state...\n');
    }

    // Step 1: Initialize mint state
    try {
        const tx = await program.methods
            .initialize(LIGHT_CLIENT_PROGRAM)
            .accounts({
                mintState: mintStatePda,
                dgnMint: DGN_MINT,
                authority: authority.publicKey,
                tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([authority])
            .rpc();

        console.log('✅ Mint state initialized!');
        console.log(`   Transaction: ${tx}\n`);
    } catch (err: any) {
        console.error('❌ Failed to initialize:', err.message);
        throw err;
    }

    // Step 2: Transfer mint authority to PDA
    console.log('📤 Transferring mint authority to PDA...\n');

    try {
        const sig = await setAuthority(
            connection,
            authority,
            DGN_MINT,
            authority.publicKey,
            AuthorityType.MintTokens,
            mintStatePda
        );

        console.log('✅ Mint authority transferred!');
        console.log(`   Transaction: ${sig}`);
        console.log(`   New authority: ${mintStatePda.toBase58()}\n`);
    } catch (err: any) {
        console.error('❌ Failed to transfer authority:', err.message);
        throw err;
    }

    console.log('✅ DGN Mint Program Initialization Complete!');
    console.log('='.repeat(60));
    console.log('DGN mint program is ready to mint tokens from verified burns');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Error:', err);
        process.exit(1);
    });
