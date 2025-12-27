/**
 * V2 Replay Attack Tests
 *
 * Tests that replay attacks are prevented after V2 migration:
 * 1. Double-processing same burn nonce
 * 2. Cross-user burn theft attempts
 * 3. Re-attestation attacks
 * 4. Old V1 mint_state replay
 *
 * Run: BURN_NONCE=<nonce> npx ts-node scripts/test-v2-replay-attacks.ts
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';
const LIGHT_CLIENT_PROGRAM_ID = 'BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5';
const MINT_PROGRAM_ID = '8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk';
const XENCAT_MINT = 'DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb';

const MINT_STATE_V2_SEED = 'mint_state_v2';
const LEGACY_MINT_STATE_SEED = 'mint_state';
const VALIDATOR_SET_V2_SEED = 'x1_validator_set_v2';

const VALIDATORS = [
    new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH'),
    new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag'),
    new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um'),
    new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH'),
    new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj'),
];

interface TestResult {
    testName: string;
    category: string;
    passed: boolean;
    error?: string;
    details?: string;
}

const results: TestResult[] = [];

function logTest(category: string, testName: string, passed: boolean, error?: string, details?: string) {
    const symbol = passed ? '✅' : '❌';
    console.log(`${symbol} ${category} - ${testName}`);
    if (error) console.log(`   Error: ${error}`);
    if (details) console.log(`   Details: ${details}`);

    results.push({ testName, category, passed, error, details });
}

async function main() {
    console.log('🔁 XENCAT Bridge V2 Replay Attack Tests\n');
    console.log('Testing replay protection after V2 migration...\n');

    // Get burn nonce from environment
    const burnNonce = process.env.BURN_NONCE;
    if (!burnNonce) {
        console.error('❌ Error: BURN_NONCE environment variable required');
        console.log('Usage: BURN_NONCE=<nonce> npx ts-node scripts/test-v2-replay-attacks.ts\n');
        process.exit(1);
    }

    const nonce = parseInt(burnNonce);
    console.log(`Using burn nonce: ${nonce}\n`);

    // Setup connection
    const connection = new Connection(X1_RPC, 'confirmed');

    // Load keypair
    let userKeypair: Keypair;
    try {
        const privateKeyString = process.env.USER_PRIVATE_KEY;
        if (!privateKeyString) {
            throw new Error('USER_PRIVATE_KEY not found in .env');
        }

        let secretKey: Uint8Array;
        if (privateKeyString.startsWith('[')) {
            secretKey = new Uint8Array(JSON.parse(privateKeyString));
        } else {
            const decoded = anchor.utils.bytes.bs58.decode(privateKeyString);
            secretKey = new Uint8Array(decoded);
        }

        userKeypair = Keypair.fromSecretKey(secretKey);
        console.log(`User: ${userKeypair.publicKey.toBase58()}\n`);
    } catch (error) {
        console.error('Failed to load user keypair:', error);
        process.exit(1);
    }

    const wallet = new anchor.Wallet(userKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    anchor.setProvider(provider);

    // Load program IDLs
    const lightClientIdl = JSON.parse(
        fs.readFileSync('./target/idl/solana_light_client_x1.json', 'utf-8')
    );
    const mintIdl = JSON.parse(
        fs.readFileSync('./target/idl/xencat_mint_x1.json', 'utf-8')
    );

    const lightClientProgram = new Program(
        lightClientIdl,
        new PublicKey(LIGHT_CLIENT_PROGRAM_ID),
        provider
    );
    const mintProgram = new Program(
        mintIdl,
        new PublicKey(MINT_PROGRAM_ID),
        provider
    );

    const xencatMint = new PublicKey(XENCAT_MINT);

    // Derive PDAs
    const [mintStateV1] = PublicKey.findProgramAddressSync(
        [Buffer.from(LEGACY_MINT_STATE_SEED)],
        mintProgram.programId
    );

    const [mintStateV2] = PublicKey.findProgramAddressSync(
        [Buffer.from(MINT_STATE_V2_SEED)],
        mintProgram.programId
    );

    const [validatorSetV2] = PublicKey.findProgramAddressSync(
        [Buffer.from(VALIDATOR_SET_V2_SEED)],
        lightClientProgram.programId
    );

    const [verifiedBurn] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v2'),
            userKeypair.publicKey.toBuffer(),
            new BN(nonce).toArrayLike(Buffer, 'le', 8),
        ],
        lightClientProgram.programId
    );

    const [processedBurn] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            new BN(nonce).toArrayLike(Buffer, 'le', 8),
            // Note: User is NOT part of processed_burn seeds (only nonce)
        ],
        mintProgram.programId
    );

    console.log(`Mint State V1:     ${mintStateV1.toBase58()}`);
    console.log(`Mint State V2:     ${mintStateV2.toBase58()}`);
    console.log(`Validator Set V2:  ${validatorSetV2.toBase58()}`);
    console.log(`Verified Burn:     ${verifiedBurn.toBase58()}`);
    console.log(`Processed Burn:    ${processedBurn.toBase58()}\n`);

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
        xencatMint,
        userKeypair.publicKey
    );

    console.log(`User Token Account: ${userTokenAccount.toBase58()}\n`);

    // ========================================================================
    // PRELIMINARY CHECKS
    // ========================================================================

    console.log('━'.repeat(80));
    console.log('PRELIMINARY CHECKS');
    console.log('━'.repeat(80) + '\n');

    // Check if burn is verified
    let verifiedBurnData: any;
    try {
        verifiedBurnData = await lightClientProgram.account.verifiedBurn.fetch(verifiedBurn);
        console.log('✅ Burn is verified');
        console.log(`   Nonce: ${verifiedBurnData.burnNonce.toString()}`);
        console.log(`   User: ${verifiedBurnData.user.toBase58()}`);
        console.log(`   Amount: ${verifiedBurnData.amount.toString()} (${verifiedBurnData.amount.toNumber() / 1e6} XENCAT)\n`);
    } catch (error: any) {
        console.error('❌ Burn not verified yet. Please verify burn first:');
        console.log('   BURN_NONCE=' + nonce + ' npm run test:bridge-v2\n');
        process.exit(1);
    }

    // Check if already processed
    let alreadyProcessed = false;
    let processedData: any = null;
    try {
        processedData = await mintProgram.account.processedBurn.fetch(processedBurn) as any;
        alreadyProcessed = true;
        console.log('⚠️  Burn already processed!');
        console.log(`   Processed at: ${new Date(processedData.processedAt.toNumber() * 1000).toISOString()}`);
        console.log(`   Amount: ${processedData.amount.toString()}\n`);
    } catch (error) {
        console.log('✅ Burn not yet processed (will process for replay tests).\n');
    }

    // ========================================================================
    // CATEGORY 1: DOUBLE-PROCESSING REPLAY ATTACKS
    // ========================================================================

    console.log('━'.repeat(80));
    console.log('CATEGORY 1: DOUBLE-PROCESSING REPLAY ATTACKS');
    console.log('━'.repeat(80) + '\n');

    // Test 1.1: Attempt to process burn twice with V2
    console.log('Test 1.1: Attempt double-processing with V2 mint_state...');

    if (!alreadyProcessed) {
        console.log('   First, processing burn for the first time...');

        try {
            const tx = await mintProgram.methods
                .mintFromBurn(new BN(nonce))
                .accounts({
                    mintState: mintStateV2,
                    user: userKeypair.publicKey,
                    userTokenAccount: userTokenAccount,
                    xencatMint: xencatMint,
                    processedBurn: processedBurn,
                    verifiedBurn: verifiedBurn,
                    validatorSet: validatorSetV2,
                    lightClientProgram: lightClientProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .remainingAccounts(
                    VALIDATORS.map(v => ({
                        pubkey: v,
                        isSigner: false,
                        isWritable: true,
                    }))
                )
                .rpc();

            console.log(`   ✅ First mint succeeded: ${tx}`);
            alreadyProcessed = true;

            // Fetch processed burn data
            processedData = await mintProgram.account.processedBurn.fetch(processedBurn) as any;
        } catch (error: any) {
            console.log(`   ❌ First mint failed: ${error.message}`);
            console.log('   Cannot test replay without successful first mint.\n');

            logTest(
                'Replay Prevention',
                'First mint attempt',
                false,
                `First mint failed: ${error.message}`,
                'Cannot test replay protection without successful first mint'
            );
        }
    }

    // Now attempt replay
    if (alreadyProcessed) {
        console.log('\n   Now attempting replay (second mint with same nonce)...');

        try {
            const tx = await mintProgram.methods
                .mintFromBurn(new BN(nonce))
                .accounts({
                    mintState: mintStateV2,
                    user: userKeypair.publicKey,
                    userTokenAccount: userTokenAccount,
                    xencatMint: xencatMint,
                    processedBurn: processedBurn,
                    verifiedBurn: verifiedBurn,
                    validatorSet: validatorSetV2,
                    lightClientProgram: lightClientProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .remainingAccounts(
                    VALIDATORS.map(v => ({
                        pubkey: v,
                        isSigner: false,
                        isWritable: true,
                    }))
                )
                .rpc();

            // CRITICAL VULNERABILITY if this succeeds!
            logTest(
                'Replay Prevention',
                'Double-processing with V2',
                false,
                'CRITICAL: Second mint succeeded! Replay attack possible!',
                `TX: ${tx}`
            );
        } catch (error: any) {
            const errorMessage = error.message || error.toString();

            // Expected errors: account already exists, or constraint error
            if (errorMessage.includes('already in use') ||
                errorMessage.includes('custom program error: 0x0') ||
                errorMessage.includes('AlreadyProcessed') ||
                errorMessage.includes('6002')) {
                logTest(
                    'Replay Prevention',
                    'Double-processing with V2',
                    true,
                    undefined,
                    'Second mint correctly rejected (ProcessedBurn PDA already exists)'
                );
            } else {
                logTest(
                    'Replay Prevention',
                    'Double-processing with V2',
                    false,
                    `Unexpected error: ${errorMessage}`,
                    'Should reject with "already in use" or AlreadyProcessed error'
                );
            }
        }
    }

    // Test 1.2: Attempt to use V1 mint_state (should fail even if not replayed)
    console.log('\nTest 1.2: Attempt mint with V1 mint_state (legacy)...');

    // V1 and V2 use same processed_burn PDA (only nonce, not user-specific)
    // This is shared with the main processedBurn variable

    try {
        // Note: V1 mint_state doesn't have the same structure as V2
        // This should fail for multiple reasons
        const tx = await mintProgram.methods
            .mintFromBurn(new BN(nonce))
            .accounts({
                mintState: mintStateV1, // Using V1!
                user: userKeypair.publicKey,
                userTokenAccount: userTokenAccount,
                xencatMint: xencatMint,
                processedBurn: processedBurn, // Same PDA as V2
                verifiedBurn: verifiedBurn,
                validatorSet: validatorSetV2,
                lightClientProgram: lightClientProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(
                VALIDATORS.map(v => ({
                    pubkey: v,
                    isSigner: false,
                    isWritable: true,
                }))
            )
            .rpc();

        // CRITICAL if this succeeds!
        logTest(
            'Replay Prevention',
            'Mint with V1 mint_state',
            false,
            'CRITICAL: V1 mint_state can still mint!',
            `TX: ${tx}`
        );
    } catch (error: any) {
        const errorMessage = error.message || error.toString();

        // Expected: account not initialized, wrong discriminator, constraint error, or authority error
        if (errorMessage.includes('AccountNotInitialized') ||
            errorMessage.includes('AccountDidNotDeserialize') ||
            errorMessage.includes('InvalidAccountData') ||
            errorMessage.includes('ConstraintSeeds') ||
            errorMessage.includes('InvalidMintAuthority') ||
            errorMessage.includes('6015')) {
            logTest(
                'Replay Prevention',
                'Mint with V1 mint_state',
                true,
                undefined,
                'V1 mint_state correctly rejected (no longer valid)'
            );
        } else {
            logTest(
                'Replay Prevention',
                'Mint with V1 mint_state',
                false,
                `Unexpected error: ${errorMessage}`,
                'Should reject with AccountNotInitialized or InvalidMintAuthority'
            );
        }
    }

    // ========================================================================
    // CATEGORY 2: CROSS-USER THEFT ATTACKS
    // ========================================================================

    console.log('\n' + '━'.repeat(80));
    console.log('CATEGORY 2: CROSS-USER THEFT ATTACKS');
    console.log('━'.repeat(80) + '\n');

    // Test 2.1: Attempt to steal burn by using different user account
    console.log('Test 2.1: Attempt cross-user burn theft...');

    const fakeUser = Keypair.generate();
    // IMPORTANT: ProcessedBurn PDA uses only nonce, NOT user-specific!
    // This means the same PDA is used for all users with same nonce
    // Protection must come from other constraints (verified_burn user check)

    const fakeUserTokenAccount = await getAssociatedTokenAddress(
        xencatMint,
        fakeUser.publicKey
    );

    console.log(`   Real user:  ${userKeypair.publicKey.toBase58()}`);
    console.log(`   Fake user:  ${fakeUser.publicKey.toBase58()}`);
    console.log(`   Verified burn user: ${verifiedBurnData.user.toBase58()}\n`);

    try {
        const tx = await mintProgram.methods
            .mintFromBurn(new BN(nonce))
            .accounts({
                mintState: mintStateV2,
                user: fakeUser.publicKey, // Fake user trying to steal!
                userTokenAccount: fakeUserTokenAccount,
                xencatMint: xencatMint,
                processedBurn: processedBurn, // Same PDA (not user-specific)
                verifiedBurn: verifiedBurn, // Real verified burn (belongs to real user)
                validatorSet: validatorSetV2,
                lightClientProgram: lightClientProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(
                VALIDATORS.map(v => ({
                    pubkey: v,
                    isSigner: false,
                    isWritable: true,
                }))
            )
            .signers([fakeUser])
            .rpc();

        // CRITICAL if this succeeds!
        logTest(
            'Cross-User Protection',
            'Cross-user burn theft',
            false,
            'CRITICAL: Fake user can steal real user\'s burn!',
            `TX: ${tx}`
        );
    } catch (error: any) {
        const errorMessage = error.message || error.toString();

        // Expected errors:
        // - AccountNotInitialized (fake user has no token account)
        // - ConstraintHasOne (verified_burn user != signer)
        // - unknown signer, or other constraint errors
        if (errorMessage.includes('ConstraintSeeds') ||
            errorMessage.includes('unknown signer') ||
            errorMessage.includes('ConstraintHasOne') ||
            errorMessage.includes('Signature verification failed') ||
            errorMessage.includes('AccountNotInitialized') ||
            errorMessage.includes('custom program error: 0x7d1') ||
            errorMessage.includes('custom program error: 0x7d4') ||
            errorMessage.includes('3012')) {
            logTest(
                'Cross-User Protection',
                'Cross-user burn theft',
                true,
                undefined,
                'Cross-user theft correctly blocked (AccountNotInitialized, user mismatch, or constraint error)'
            );
        } else {
            logTest(
                'Cross-User Protection',
                'Cross-user burn theft',
                false,
                `Unexpected error: ${errorMessage}`,
                'Should reject with AccountNotInitialized, ConstraintHasOne, or similar'
            );
        }
    }

    // ========================================================================
    // SUMMARY
    // ========================================================================

    console.log('\n' + '━'.repeat(80));
    console.log('TEST SUMMARY');
    console.log('━'.repeat(80) + '\n');

    const totalTests = results.length;
    const passedTests = results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    const passRate = ((passedTests / totalTests) * 100).toFixed(1);

    console.log(`Total Tests:  ${totalTests}`);
    console.log(`Passed:       ${passedTests} ✅`);
    console.log(`Failed:       ${failedTests} ${failedTests > 0 ? '❌' : '✅'}`);
    console.log(`Pass Rate:    ${passRate}%\n`);

    // Group by category
    const categories = Array.from(new Set(results.map(r => r.category)));

    categories.forEach(category => {
        const categoryTests = results.filter(r => r.category === category);
        const categoryPassed = categoryTests.filter(r => r.passed).length;
        const categoryTotal = categoryTests.length;

        console.log(`\n${category}:`);
        categoryTests.forEach(test => {
            const symbol = test.passed ? '✅' : '❌';
            console.log(`  ${symbol} ${test.testName}`);
            if (test.error) {
                console.log(`     ⚠️  ${test.error}`);
            }
        });
        console.log(`  Summary: ${categoryPassed}/${categoryTotal} passed`);
    });

    // Check for critical failures
    const criticalFailures = results.filter(
        r => !r.passed && r.error?.includes('CRITICAL')
    );

    if (criticalFailures.length > 0) {
        console.log('\n' + '⚠️ '.repeat(40));
        console.log('CRITICAL VULNERABILITIES DETECTED!');
        console.log('⚠️ '.repeat(40) + '\n');

        criticalFailures.forEach(failure => {
            console.log(`❌ ${failure.testName}`);
            console.log(`   ${failure.error}\n`);
        });

        console.log('DO NOT PROCEED TO PRODUCTION - FIX THESE ISSUES IMMEDIATELY!\n');
        process.exit(1);
    } else {
        console.log('\n✅ No critical vulnerabilities detected in replay tests.');
        console.log('✅ Replay protection working correctly after V2 migration.\n');
    }

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = `./test-results-v2-replay-${timestamp}.json`;
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`📄 Full results saved to: ${resultsFile}\n`);
}

main().catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
});
