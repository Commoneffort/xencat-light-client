/**
 * Deploy DGN token on X1
 * Creates a new SPL token mint with 6 decimals
 */

import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint } from '@solana/spl-token';
import bs58 from 'bs58';

const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';

async function main() {
    console.log('🪙 Deploying DGN Token on X1\n');

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

    const connection = new Connection(X1_RPC, 'confirmed');

    console.log('\n📤 Creating DGN token mint...');
    console.log('   Decimals: 6');
    console.log('   Mint authority: Mint State PDA (will be set after init)');
    console.log('   Freeze authority: None\n');

    const dgnMint = await createMint(
        connection,
        authority,
        authority.publicKey, // Initial mint authority (will transfer to PDA)
        null, // No freeze authority
        6 // 6 decimals (same as Solana DGN)
    );

    console.log('✅ DGN Token Created!');
    console.log(`   Mint: ${dgnMint.toBase58()}`);
    console.log('\n⚠️  SAVE THIS MINT ADDRESS!');
    console.log('   You will need it to:');
    console.log('   1. Initialize DGN mint program');
    console.log('   2. Transfer mint authority to DGN mint state PDA');
    console.log('   3. Create user token accounts');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Error:', err);
        process.exit(1);
    });
