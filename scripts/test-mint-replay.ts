import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from '@solana/spl-token';
import { XencatMintX1 } from '../target/types/xencat_mint_x1';
import fs from 'fs';
import 'dotenv/config';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT_X1 = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');
const LIGHT_CLIENT_ID = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');

async function main() {
    const BURN_NONCE = parseInt(process.env.BURN_NONCE || '0');

    console.log('🔁 TESTING MINT REPLAY ATTACK');
    console.log('━'.repeat(60));
    console.log(`🔥 Burn Nonce: ${BURN_NONCE}\n`);

    // Load keypair
    let userKeypair: Keypair;
    const userPrivateKey = process.env.USER_PRIVATE_KEY;

    if (userPrivateKey) {
        try {
            const privateKeyArray = JSON.parse(userPrivateKey);
            userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
        } catch {
            const bs58 = require('bs58');
            userKeypair = Keypair.fromSecretKey(bs58.decode(userPrivateKey));
        }
    } else {
        const keypairPath = process.env.HOME + '/.config/solana/identity.json';
        const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    }

    console.log('👤 User:', userKeypair.publicKey.toBase58());

    // Setup connection
    const x1Connection = new Connection(X1_RPC, 'confirmed');
    const x1Provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
    );

    // Load mint program
    const mintProgramId = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');
    const mintIdl = JSON.parse(fs.readFileSync('./target/idl/xencat_mint_x1.json', 'utf-8'));
    const mintProgram = new Program(mintIdl, mintProgramId, x1Provider) as Program<XencatMintX1>;

    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        mintProgram.programId
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        mintProgram.programId
    );

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v2'),
            userKeypair.publicKey.toBuffer(),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        LIGHT_CLIENT_ID
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT_X1,
        userKeypair.publicKey
    );

    // Fetch mint state for fee receiver
    const mintState = await mintProgram.account.mintState.fetch(mintStatePda);

    // First mint attempt
    console.log('\n━'.repeat(60));
    console.log('ATTEMPT 1: Mint tokens (should succeed)');
    console.log('━'.repeat(60));

    try {
        const tx1 = await mintProgram.methods
            .mintFromBurn(new anchor.BN(BURN_NONCE))
            .accounts({
                mintState: mintStatePda,
                xencatMint: XENCAT_MINT_X1,
                processedBurn: processedBurnPda,
                userTokenAccount,
                user: userKeypair.publicKey,
                mintFeeReceiver: mintState.feeReceiver,
                verifiedBurn: verifiedBurnPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        console.log('✅ First mint succeeded!');
        console.log('📝 TX:', tx1);
    } catch (error: any) {
        console.error('❌ First mint failed (unexpected):', error.message);
        process.exit(1);
    }

    // Wait a moment
    console.log('\n⏳ Waiting 2 seconds...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Second mint attempt (REPLAY ATTACK)
    console.log('━'.repeat(60));
    console.log('ATTEMPT 2: Mint again (should FAIL - replay protection)');
    console.log('━'.repeat(60));

    try {
        const tx2 = await mintProgram.methods
            .mintFromBurn(new anchor.BN(BURN_NONCE))
            .accounts({
                mintState: mintStatePda,
                xencatMint: XENCAT_MINT_X1,
                processedBurn: processedBurnPda,
                userTokenAccount,
                user: userKeypair.publicKey,
                mintFeeReceiver: mintState.feeReceiver,
                verifiedBurn: verifiedBurnPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        console.log('❌ TEST FAILED: Second mint succeeded (replay attack worked!)');
        console.log('📝 TX:', tx2);
        process.exit(1);

    } catch (error: any) {
        console.log('✅ TEST PASSED: Second mint rejected!');
        console.log('🔒 Replay protection working correctly');

        if (error.message.includes('already in use') || error.message.includes('0x0')) {
            console.log('📝 Error: PDA already exists (processed_burn)');
        } else {
            console.log('📝 Error:', error.message);
        }

        if (error.logs) {
            console.log('\n📜 Program Logs:');
            error.logs.slice(0, 10).forEach((log: string) => console.log('  ', log));
        }
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 TEST 1.2 COMPLETED SUCCESSFULLY!');
    console.log('━'.repeat(60));
    console.log('✅ Mint replay protection verified');
    console.log('🔒 Same nonce cannot be minted twice');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
