import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');
const USER_WALLET = new PublicKey('DEQWNRhQmNg7T6UQxV8d2oJAanFHBu9YkNyXDb7GvzvA');

async function main() {
    const connection = new Connection(X1_RPC);

    // Get user's XENCAT token account
    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT,
        USER_WALLET
    );

    console.log('\n💰 XENCAT Balance Check');
    console.log('━'.repeat(60));
    console.log('Wallet:', USER_WALLET.toBase58());
    console.log('Token Account:', userTokenAccount.toBase58());
    console.log();

    try {
        const accountInfo = await getAccount(connection, userTokenAccount);

        const balance = Number(accountInfo.amount) / 1_000_000; // 6 decimals

        console.log('✅ XENCAT Balance:', balance.toFixed(6), 'XENCAT');
        console.log('   Raw Amount:', accountInfo.amount.toString(), 'lamports');
        console.log('   Decimals: 6');
        console.log();

        if (balance === 0) {
            console.log('⚠️  WARNING: Your balance is ZERO!');
            console.log('   You cannot sell XENCAT if you have none.');
        } else if (balance < 0.01) {
            console.log('⚠️  WARNING: Very low balance!');
            console.log('   Make sure you\'re not trying to sell more than you have.');
        } else {
            console.log('✅ You have XENCAT tokens.');
            console.log('   Make sure your sell amount is LESS than', balance.toFixed(6));
        }

    } catch (error: any) {
        console.log('❌ Token account does not exist!');
        console.log('   This means you have NO XENCAT tokens in this wallet.');
        console.log();
        console.log('Error:', error.message);
    }

    console.log('━'.repeat(60));
}

main().catch(console.error);
