/**
 * Check for existing burns on Solana mainnet that we can use for testing
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

const BURN_PROGRAM_ID = new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

async function checkExistingBurns() {
    console.log('\n🔍 Checking for Existing Burns on Solana Mainnet\n');

    const connection = new Connection(SOLANA_RPC, 'confirmed');

    // Get global state to see how many burns exist
    const [globalStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('global_state')],
        BURN_PROGRAM_ID
    );

    try {
        const accountInfo = await connection.getAccountInfo(globalStatePda);

        if (!accountInfo) {
            console.log('❌ No global state found - burn program may not be initialized\n');
            return;
        }

        console.log('📊 Global State Account:');
        console.log('   Address:', globalStatePda.toString());
        console.log('   Data length:', accountInfo.data.length, 'bytes');

        // Parse global state manually (8 byte discriminator + data)
        const data = accountInfo.data;

        // Skip 8 byte discriminator
        const nonceCounter = data.readBigUInt64LE(8);
        const totalBurns = data.readBigUInt64LE(16);
        const totalAmountBurned = data.readBigUInt64LE(24);

        console.log('\n📈 Burn Statistics:');
        console.log('   Nonce Counter:', nonceCounter.toString());
        console.log('   Total Burns:', totalBurns.toString());
        console.log('   Total Amount Burned:', (Number(totalAmountBurned) / 1_000_000).toFixed(6), 'XENCAT');
        console.log();

        if (totalBurns > BigInt(0)) {
            console.log('✅ Found existing burns! Checking recent burn records...\n');

            // Check the last few burn records
            const recentBurns = Math.min(5, Number(nonceCounter));

            for (let i = Math.max(0, Number(nonceCounter) - recentBurns); i < Number(nonceCounter); i++) {
                const [burnRecordPda] = PublicKey.findProgramAddressSync(
                    [
                        Buffer.from('burn_record'),
                        Buffer.from(new BigUint64Array([BigInt(i)]).buffer)
                    ],
                    BURN_PROGRAM_ID
                );

                const burnRecord = await connection.getAccountInfo(burnRecordPda);

                if (burnRecord) {
                    const burnData = burnRecord.data;
                    // Skip discriminator (8 bytes)
                    const user = new PublicKey(burnData.slice(8, 40));
                    const amount = burnData.readBigUInt64LE(40);
                    const nonce = burnData.readBigUInt64LE(48);
                    const timestamp = burnData.readBigUInt64LE(56);

                    console.log(`🔥 Burn #${i}:`);
                    console.log(`   Nonce: ${nonce}`);
                    console.log(`   User: ${user.toString()}`);
                    console.log(`   Amount: ${(Number(amount) / 1_000_000).toFixed(6)} XENCAT`);
                    console.log(`   Timestamp: ${new Date(Number(timestamp) * 1000).toISOString()}`);
                    console.log(`   Burn Record PDA: ${burnRecordPda.toString()}`);
                    console.log();
                }
            }

            console.log('💡 You can use any of these burn nonces for testing!\n');
            console.log('To test the bridge:');
            console.log('   1. Choose a nonce from above');
            console.log('   2. Generate proof: npm run generate-proof -- --nonce <NONCE>');
            console.log('   3. Submit to X1 testnet\n');
        } else {
            console.log('⚠️  No burns found yet.');
            console.log('You need to burn some XENCAT on Solana mainnet first.\n');
            console.log('Options:');
            console.log('   1. Run: npm run test:e2e (burns 0.01 XENCAT)');
            console.log('   2. Use a wallet with XENCAT and burn manually\n');
        }

    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }
}

checkExistingBurns().catch(console.error);
