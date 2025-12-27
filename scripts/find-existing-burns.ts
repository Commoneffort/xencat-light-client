/**
 * Find Existing Burns on Solana Mainnet
 *
 * This script searches for existing burn records that can be used for testing.
 * It checks the burn program for any burn records created by the user.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const BURN_PROGRAM_ID = new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');

async function main() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║  🔍 SEARCHING FOR EXISTING BURNS                  ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    console.log(`🌐 Solana RPC: ${SOLANA_RPC}`);
    console.log(`🔥 Burn Program: ${BURN_PROGRAM_ID.toBase58()}\n`);

    // Get user from environment
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        console.error('❌ USER_PRIVATE_KEY environment variable not set');
        console.log('   Set it in .env file or export it:\n');
        console.log('   export USER_PRIVATE_KEY=\'[...]\'');
        return;
    }

    let userPublicKey: PublicKey;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        const keypair = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
        userPublicKey = keypair.publicKey;
    } catch {
        try {
            const keypair = anchor.web3.Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
            userPublicKey = keypair.publicKey;
        } catch {
            console.error('❌ Invalid USER_PRIVATE_KEY format');
            console.log('   Must be either JSON array or base58 string');
            return;
        }
    }

    console.log(`👤 User: ${userPublicKey.toBase58()}\n`);

    console.log('═══════════════════════════════════════════════════════');
    console.log('Method 1: Check Known Nonces');
    console.log('═══════════════════════════════════════════════════════\n');

    // Try common nonce ranges
    const noncesToCheck = [
        // Recent timestamps
        ...Array.from({ length: 10 }, (_, i) => Date.now() - i * 86400000), // Last 10 days
        // Common test nonces
        1, 2, 3, 4, 5, 100, 1000,
    ];

    const foundBurns: Array<{
        nonce: number;
        pda: PublicKey;
        exists: boolean;
    }> = [];

    console.log(`🔎 Checking ${noncesToCheck.length} potential nonces...\n`);

    for (const nonce of noncesToCheck) {
        try {
            const [burnRecordPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('burn_record'),
                    userPublicKey.toBuffer(),
                    new anchor.BN(nonce).toArrayLike(Buffer, 'le', 8),
                ],
                BURN_PROGRAM_ID
            );

            const accountInfo = await connection.getAccountInfo(burnRecordPda);
            if (accountInfo) {
                foundBurns.push({
                    nonce,
                    pda: burnRecordPda,
                    exists: true,
                });
                console.log(`✅ Found burn record!`);
                console.log(`   Nonce: ${nonce}`);
                console.log(`   PDA: ${burnRecordPda.toBase58()}`);
                console.log(`   Data size: ${accountInfo.data.length} bytes\n`);
            }
        } catch (error) {
            // Nonce doesn't exist, continue
        }
    }

    if (foundBurns.length === 0) {
        console.log('❌ No burn records found with common nonces\n');
    } else {
        console.log(`\n✅ Found ${foundBurns.length} burn record(s)!\n`);
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('Method 2: Query Program Accounts');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('🔎 Querying all accounts owned by burn program...');
    console.log('   (This may take a while...)\n');

    try {
        // Get all accounts for the burn program
        const accounts = await connection.getProgramAccounts(BURN_PROGRAM_ID, {
            filters: [
                {
                    memcmp: {
                        offset: 8, // After discriminator
                        bytes: userPublicKey.toBase58(),
                    },
                },
            ],
        });

        console.log(`📊 Found ${accounts.length} account(s) for user\n`);

        if (accounts.length > 0) {
            console.log('Burn Records:\n');

            for (const { pubkey, account } of accounts) {
                console.log(`  PDA: ${pubkey.toBase58()}`);
                console.log(`  Size: ${account.data.length} bytes`);

                // Try to parse burn record
                try {
                    // Burn record structure:
                    // - discriminator: 8 bytes
                    // - user: 32 bytes
                    // - amount: 8 bytes
                    // - nonce: 8 bytes
                    // - timestamp: 8 bytes
                    // - record_hash: 32 bytes

                    const nonce = account.data.readBigUInt64LE(8 + 32 + 8);
                    const amount = account.data.readBigUInt64LE(8 + 32);

                    console.log(`  Nonce: ${nonce}`);
                    console.log(`  Amount: ${Number(amount) / 1_000_000} XENCAT`);
                } catch (error) {
                    console.log(`  (Could not parse burn record)`);
                }

                console.log('');
            }

            console.log(`\n✅ You can use any of these nonces for testing!\n`);
            console.log(`Example command:`);
            if (accounts.length > 0) {
                try {
                    const firstAccount = accounts[0];
                    const nonce = firstAccount.account.data.readBigUInt64LE(8 + 32 + 8);
                    console.log(`  npm run test:proof -- --nonce ${nonce}\n`);
                } catch {
                    console.log(`  npm run test:proof -- --nonce <nonce>\n`);
                }
            }
        } else {
            console.log('❌ No burn records found for this user\n');
            console.log('To create a burn record:');
            console.log('  1. Burn XENCAT on Solana mainnet');
            console.log('  2. Use the burn program: 2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');
            console.log('  3. Or run: npm run burn:test -- --amount 0.01\n');
        }
    } catch (error: any) {
        console.error(`\n❌ Failed to query program accounts:`);
        console.error(error.message);

        if (error.message.includes('429')) {
            console.log('\n⚠️  Rate limited by RPC. Try again in a few seconds or use a different RPC.\n');
        }
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('Summary');
    console.log('═══════════════════════════════════════════════════════\n');

    if (foundBurns.length > 0) {
        console.log(`✅ Found ${foundBurns.length} existing burn(s) ready for testing!`);
        console.log(`\nNext steps:`);
        console.log(`  1. Generate proof: npm run generate:proof -- --nonce ${foundBurns[0].nonce}`);
        console.log(`  2. Submit to X1: npm run submit:proof`);
        console.log(`  3. Verify mint: npm run check:balance\n`);
    } else {
        console.log(`⚠️  No existing burns found for this user.`);
        console.log(`\nOptions:`);
        console.log(`  1. Burn XENCAT on Solana mainnet (costs real tokens)`);
        console.log(`  2. Use a different wallet that has burns`);
        console.log(`  3. Wait for the 42 known burns to be processed\n`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
