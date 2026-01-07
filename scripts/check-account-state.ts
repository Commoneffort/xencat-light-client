import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, AccountState } from '@solana/spl-token';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');
const USER_WALLET = new PublicKey('DEQWNRhQmNg7T6UQxV8d2oJAanFHBu9YkNyXDb7GvzvA');

async function main() {
    const connection = new Connection(X1_RPC);

    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT,
        USER_WALLET
    );

    console.log('\n🔍 Deep Token Account Analysis');
    console.log('━'.repeat(60));
    console.log('Mint (what you should see):', XENCAT_MINT.toBase58());
    console.log('Your Wallet:', USER_WALLET.toBase58());
    console.log('Your Token Account:', userTokenAccount.toBase58());
    console.log('━'.repeat(60));

    try {
        const accountInfo = await getAccount(connection, userTokenAccount);

        const balance = Number(accountInfo.amount) / 1_000_000;

        console.log('\n💰 Balance:', balance.toFixed(6), 'XENCAT');
        console.log('   Raw:', accountInfo.amount.toString());

        console.log('\n🔐 Account State:');
        console.log('   Frozen:', accountInfo.isFrozen ? '❌ YES (PROBLEM!)' : '✅ No');
        console.log('   Owner:', accountInfo.owner.toBase58());
        console.log('   Mint:', accountInfo.mint.toBase58());

        console.log('\n👤 Authorities:');
        console.log('   Delegate:', accountInfo.delegate ? accountInfo.delegate.toBase58() : '✅ None');
        console.log('   Delegated Amount:', accountInfo.delegatedAmount.toString());
        console.log('   Close Authority:', accountInfo.closeAuthority ? accountInfo.closeAuthority.toBase58() : '✅ None');

        // Check for issues
        const issues = [];

        if (accountInfo.isFrozen) {
            issues.push('❌ CRITICAL: Account is FROZEN! Cannot transfer tokens.');
        }

        if (accountInfo.delegate && accountInfo.delegatedAmount > 0) {
            issues.push(`⚠️ WARNING: ${accountInfo.delegatedAmount} tokens delegated to ${accountInfo.delegate.toBase58()}`);
            issues.push('   This might interfere with DEX trades. Try revoking delegate.');
        }

        if (accountInfo.mint.toBase58() !== XENCAT_MINT.toBase58()) {
            issues.push('❌ CRITICAL: Token account mint mismatch!');
        }

        console.log('\n🔎 Diagnosis:');
        if (issues.length === 0) {
            console.log('✅ No obvious account issues found.');
            console.log('\nPossible causes of "insufficient funds":');
            console.log('1. DEX is trying to transfer more than balance (rounding/slippage)');
            console.log('2. DEX bug with 6-decimal tokens');
            console.log('3. Need to leave rent-exempt minimum in account');
            console.log('4. Token account has different address than DEX expects');
        } else {
            issues.forEach(issue => console.log(issue));
        }

    } catch (error: any) {
        console.log('❌ Error:', error.message);
    }

    console.log('\n━'.repeat(60));
}

main().catch(console.error);
