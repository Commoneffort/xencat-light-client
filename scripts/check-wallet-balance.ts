import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';

const XENCAT_MINT = new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V');
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

async function checkBalance() {
    console.log('\n💰 Checking Wallet Balance\n');

    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        console.error('❌ USER_PRIVATE_KEY not found in .env');
        process.exit(1);
    }

    let userKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log('📋 Wallet Information:');
    console.log('   Address:', userKeypair.publicKey.toBase58());
    console.log('   Network: Solana Mainnet');
    console.log('   RPC:', SOLANA_RPC);
    console.log();

    const connection = new Connection(SOLANA_RPC, 'confirmed');

    // Check SOL balance
    const solBalance = await connection.getBalance(userKeypair.publicKey);
    console.log('💵 SOL Balance:', (solBalance / 1e9).toFixed(9), 'SOL');

    // Check XENCAT balance
    const tokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT,
        userKeypair.publicKey
    );

    console.log('   Token Account:', tokenAccount.toBase58());
    console.log();

    try {
        const account = await getAccount(connection, tokenAccount);
        const balance = Number(account.amount);

        console.log('🪙 XENCAT Balance:', (balance / 1_000_000).toFixed(6), 'XENCAT');
        console.log('   Raw amount:', balance, 'lamports');
        console.log();

        if (balance >= 10_000) {
            console.log('✅ Sufficient balance for testing (need 0.01 XENCAT minimum)');
            console.log();
            console.log('Ready to run: npm run test:e2e');
        } else {
            console.log('⚠️  Insufficient XENCAT for testing');
            console.log('   Need at least 0.01 XENCAT (10,000 lamports)');
        }
        console.log();

    } catch (error: any) {
        console.log('❌ No XENCAT token account found');
        console.log('   You need to acquire XENCAT tokens first');
        console.log();
    }
}

checkBalance().catch(console.error);
