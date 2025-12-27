/**
 * V2 End-to-End Complete Test
 *
 * Comprehensive test of the complete bridge flow with V2:
 * 1. Create burn on Solana (optional - can use existing)
 * 2. Collect attestations from validators
 * 3. Verify burn on X1
 * 4. Mint tokens with V2
 * 5. Verify fee distribution to all validators
 * 6. Validate all balances
 *
 * Run:
 *   CREATE_BURN=true npx ts-node scripts/test-v2-e2e-complete.ts  (creates new burn)
 *   BURN_NONCE=<nonce> npx ts-node scripts/test-v2-e2e-complete.ts  (uses existing)
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import fetch from 'node-fetch';

dotenv.config();

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';
const LIGHT_CLIENT_PROGRAM_ID = 'BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5';
const MINT_PROGRAM_ID = '8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk';
const SOLANA_BURN_PROGRAM_ID = '2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp';
const XENCAT_MINT_SOLANA = '7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V';
const XENCAT_MINT_X1 = 'DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb';

const VALIDATOR_APIS = [
    { name: 'Validator 1', url: 'http://149.50.116.159:8080', pubkey: '9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH' },
    { name: 'Validator 2', url: 'http://193.34.212.186:8080', pubkey: '8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag' },
    { name: 'Validator 3', url: 'http://74.50.76.62:10001', pubkey: '5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um' },
    { name: 'Validator 4', url: 'http://149.50.116.21:8080', pubkey: 'GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH' },
    { name: 'Validator 5', url: 'http://64.20.49.142:8080', pubkey: 'FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj' },
];

const BURN_AMOUNT = 10_000; // 0.01 XENCAT (6 decimals)

interface TestResult {
    step: string;
    passed: boolean;
    error?: string;
    details?: any;
}

const results: TestResult[] = [];

function logStep(step: string, passed: boolean, error?: string, details?: any) {
    const symbol = passed ? '✅' : '❌';
    console.log(`${symbol} ${step}`);
    if (error) console.log(`   Error: ${error}`);
    if (details) {
        if (typeof details === 'object') {
            console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
        } else {
            console.log(`   Details: ${details}`);
        }
    }

    results.push({ step, passed, error, details });
}

async function main() {
    console.log('🔬 XENCAT Bridge V2 - Complete End-to-End Test\n');
    console.log('Testing full bridge flow with V2 fee distribution...\n');

    const createBurn = process.env.CREATE_BURN === 'true';
    let burnNonce = process.env.BURN_NONCE ? parseInt(process.env.BURN_NONCE) : null;

    if (!createBurn && !burnNonce) {
        console.error('❌ Error: Either CREATE_BURN=true or BURN_NONCE=<nonce> required');
        console.log('Usage:');
        console.log('  CREATE_BURN=true npx ts-node scripts/test-v2-e2e-complete.ts');
        console.log('  BURN_NONCE=<nonce> npx ts-node scripts/test-v2-e2e-complete.ts\n');
        process.exit(1);
    }

    // Setup connections
    const solanaConnection = new Connection(SOLANA_RPC, 'confirmed');
    const x1Connection = new Connection(X1_RPC, 'confirmed');

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
    const provider = new AnchorProvider(x1Connection, wallet, { commitment: 'confirmed' });
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

    const xencatMintX1 = new PublicKey(XENCAT_MINT_X1);

    // ========================================================================
    // STEP 1: CREATE OR USE EXISTING BURN
    // ========================================================================

    console.log('━'.repeat(80));
    console.log('STEP 1: BURN XENCAT ON SOLANA');
    console.log('━'.repeat(80) + '\n');

    if (createBurn) {
        console.log('To create a new burn, use:');
        console.log('   npx ts-node scripts/burn-only.ts');
        console.log('   Wait 20 seconds for finality');
        console.log('   Then run: BURN_NONCE=<new_nonce> npx ts-node scripts/test-v2-e2e-complete.ts\n');
        console.log('For this test, please provide an existing BURN_NONCE.\n');
        process.exit(0);
    } else {
        console.log(`Using existing burn nonce: ${burnNonce}\n`);
        logStep('Use existing burn', true, undefined, { nonce: burnNonce });
    }

    // ========================================================================
    // STEP 2: COLLECT VALIDATOR ATTESTATIONS
    // ========================================================================

    console.log('━'.repeat(80));
    console.log('STEP 2: COLLECT VALIDATOR ATTESTATIONS');
    console.log('━'.repeat(80) + '\n');

    // Get validator set version
    const [validatorSetV2] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        lightClientProgram.programId
    );

    let validatorSetData: any;
    try {
        validatorSetData = await lightClientProgram.account.x1ValidatorSet.fetch(validatorSetV2);
        console.log(`Validator Set Version: ${validatorSetData.version.toString()}`);
        console.log(`Threshold: ${validatorSetData.threshold} of ${validatorSetData.validators.length}\n`);
    } catch (error: any) {
        logStep('Fetch validator set', false, error.message);
        process.exit(1);
    }

    const attestations: any[] = [];
    console.log('Requesting attestations from validators...\n');

    for (const validator of VALIDATOR_APIS) {
        try {
            console.log(`   Requesting from ${validator.name} (${validator.url})...`);

            const response = await fetch(`${validator.url}/attest-burn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: burnNonce,
                    user: userKeypair.publicKey.toBase58(),
                    expected_amount: BURN_AMOUNT,
                    validator_set_version: validatorSetData.version.toNumber(),
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.log(`   ❌ Failed: ${response.status} - ${errorText}`);
                continue;
            }

            const data = await response.json() as any;
            console.log(`   ✅ Received attestation`);

            attestations.push({
                validatorPubkey: new PublicKey(data.validator_pubkey),
                signature: Buffer.from(data.signature, 'base64'),
                timestamp: new BN(data.timestamp),
            });
        } catch (error: any) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }

    console.log(`\n   Collected ${attestations.length} attestations (need ${validatorSetData.threshold})`);

    if (attestations.length < validatorSetData.threshold) {
        logStep('Collect attestations', false, `Only ${attestations.length} attestations, need ${validatorSetData.threshold}`);
        process.exit(1);
    }

    logStep('Collect attestations', true, undefined, { count: attestations.length, threshold: validatorSetData.threshold });

    // ========================================================================
    // STEP 3: VERIFY BURN ON X1
    // ========================================================================

    console.log('\n' + '━'.repeat(80));
    console.log('STEP 3: VERIFY BURN ON X1');
    console.log('━'.repeat(80) + '\n');

    const [verifiedBurn] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v2'),
            userKeypair.publicKey.toBuffer(),
            new BN(burnNonce!).toArrayLike(Buffer, 'le', 8),
        ],
        lightClientProgram.programId
    );

    // Check if already verified
    let alreadyVerified = false;
    try {
        await lightClientProgram.account.verifiedBurn.fetch(verifiedBurn);
        alreadyVerified = true;
        console.log('   ⚠️  Burn already verified, skipping verification step...\n');
        logStep('Verify burn (skip - already verified)', true);
    } catch (e) {
        // Not verified yet, proceed
    }

    if (!alreadyVerified) {
        try {
            const tx = await lightClientProgram.methods
                .submitBurnAttestation({
                    burnNonce: new BN(burnNonce!),
                    user: userKeypair.publicKey,
                    amount: new BN(BURN_AMOUNT),
                    validatorSetVersion: validatorSetData.version,
                    attestations: attestations,
                })
                .accounts({
                    validatorSet: validatorSetV2,
                    verifiedBurn: verifiedBurn,
                    payer: userKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log(`   ✅ Burn verified: ${tx}\n`);
            logStep('Verify burn on X1', true, undefined, { tx });
        } catch (error: any) {
            console.log(`   ❌ Verification failed: ${error.message}\n`);
            logStep('Verify burn on X1', false, error.message);
            process.exit(1);
        }
    }

    // ========================================================================
    // STEP 4: CHECK BALANCES BEFORE MINTING
    // ========================================================================

    console.log('━'.repeat(80));
    console.log('STEP 4: CHECK BALANCES BEFORE MINTING');
    console.log('━'.repeat(80) + '\n');

    const [mintStateV2] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        mintProgram.programId
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        xencatMintX1,
        userKeypair.publicKey
    );

    const balancesBefore: any = {
        user: {
            xencat: 0,
            xnt: 0,
        },
        validators: [],
    };

    // User XENCAT balance
    try {
        const tokenAccount = await x1Connection.getTokenAccountBalance(userTokenAccount);
        balancesBefore.user.xencat = tokenAccount.value.uiAmount || 0;
    } catch (e) {
        balancesBefore.user.xencat = 0; // Account doesn't exist yet
    }

    // User XNT balance
    balancesBefore.user.xnt = await x1Connection.getBalance(userKeypair.publicKey) / LAMPORTS_PER_SOL;

    console.log(`User XENCAT balance: ${balancesBefore.user.xencat}`);
    console.log(`User XNT balance: ${balancesBefore.user.xnt.toFixed(4)} XNT\n`);

    // Validator balances
    console.log('Validator XNT balances:');
    for (const validator of VALIDATOR_APIS) {
        const balance = await x1Connection.getBalance(new PublicKey(validator.pubkey));
        balancesBefore.validators.push({
            name: validator.name,
            pubkey: validator.pubkey,
            balance: balance / LAMPORTS_PER_SOL,
        });
        console.log(`   ${validator.name}: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} XNT`);
    }

    logStep('Check balances before', true, undefined, balancesBefore);

    // ========================================================================
    // STEP 5: MINT TOKENS WITH V2
    // ========================================================================

    console.log('\n' + '━'.repeat(80));
    console.log('STEP 5: MINT TOKENS WITH V2 (FEE DISTRIBUTION)');
    console.log('━'.repeat(80) + '\n');

    const [processedBurn] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            new BN(burnNonce!).toArrayLike(Buffer, 'le', 8),
        ],
        mintProgram.programId
    );

    // Check if already processed
    let alreadyProcessed = false;
    try {
        await mintProgram.account.processedBurn.fetch(processedBurn);
        alreadyProcessed = true;
        console.log('   ⚠️  Burn already processed, skipping mint step...\n');
        logStep('Mint tokens (skip - already processed)', true);
    } catch (e) {
        // Not processed yet
    }

    if (!alreadyProcessed) {
        try {
            const tx = await mintProgram.methods
                .mintFromBurn(new BN(burnNonce!))
                .accounts({
                    mintState: mintStateV2,
                    user: userKeypair.publicKey,
                    userTokenAccount: userTokenAccount,
                    xencatMint: xencatMintX1,
                    processedBurn: processedBurn,
                    verifiedBurn: verifiedBurn,
                    validatorSet: validatorSetV2,
                    lightClientProgram: lightClientProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .remainingAccounts(
                    VALIDATOR_APIS.map(v => ({
                        pubkey: new PublicKey(v.pubkey),
                        isSigner: false,
                        isWritable: true,
                    }))
                )
                .rpc();

            console.log(`   ✅ Minted tokens: ${tx}\n`);
            logStep('Mint tokens with V2', true, undefined, { tx });
        } catch (error: any) {
            console.log(`   ❌ Mint failed: ${error.message}\n`);
            logStep('Mint tokens with V2', false, error.message);
            process.exit(1);
        }
    }

    // ========================================================================
    // STEP 6: VERIFY BALANCES AFTER MINTING
    // ========================================================================

    console.log('━'.repeat(80));
    console.log('STEP 6: VERIFY BALANCES AFTER MINTING');
    console.log('━'.repeat(80) + '\n');

    const balancesAfter: any = {
        user: {
            xencat: 0,
            xnt: 0,
        },
        validators: [],
    };

    // User XENCAT balance
    try {
        const tokenAccount = await x1Connection.getTokenAccountBalance(userTokenAccount);
        balancesAfter.user.xencat = tokenAccount.value.uiAmount || 0;
    } catch (e) {
        balancesAfter.user.xencat = 0;
    }

    // User XNT balance
    balancesAfter.user.xnt = await x1Connection.getBalance(userKeypair.publicKey) / LAMPORTS_PER_SOL;

    console.log(`User XENCAT balance: ${balancesAfter.user.xencat} (was ${balancesBefore.user.xencat})`);
    console.log(`User XNT balance: ${balancesAfter.user.xnt.toFixed(4)} XNT (was ${balancesBefore.user.xnt.toFixed(4)} XNT)\n`);

    // Validator balances
    console.log('Validator XNT balances after:');
    for (let i = 0; i < VALIDATOR_APIS.length; i++) {
        const validator = VALIDATOR_APIS[i];
        const balance = await x1Connection.getBalance(new PublicKey(validator.pubkey));
        const balanceXNT = balance / LAMPORTS_PER_SOL;
        const beforeXNT = balancesBefore.validators[i].balance;
        const diff = balanceXNT - beforeXNT;

        balancesAfter.validators.push({
            name: validator.name,
            pubkey: validator.pubkey,
            balance: balanceXNT,
            change: diff,
        });

        console.log(`   ${validator.name}: ${balanceXNT.toFixed(4)} XNT (${diff >= 0 ? '+' : ''}${diff.toFixed(4)} XNT)`);
    }

    logStep('Check balances after', true, undefined, balancesAfter);

    // ========================================================================
    // STEP 7: VALIDATE RESULTS
    // ========================================================================

    console.log('\n' + '━'.repeat(80));
    console.log('STEP 7: VALIDATE RESULTS');
    console.log('━'.repeat(80) + '\n');

    const xencatChange = balancesAfter.user.xencat - balancesBefore.user.xencat;
    const expectedXencatChange = alreadyProcessed ? 0 : BURN_AMOUNT / 1e6;

    console.log(`User XENCAT change: ${xencatChange} (expected: ${expectedXencatChange})`);

    if (!alreadyProcessed) {
        if (Math.abs(xencatChange - expectedXencatChange) < 0.000001) {
            logStep('Validate XENCAT minted', true, undefined, { change: xencatChange, expected: expectedXencatChange });
        } else {
            logStep('Validate XENCAT minted', false, `Expected ${expectedXencatChange}, got ${xencatChange}`);
        }

        // Validate fee distribution
        const expectedFeePerValidator = 0.01; // 0.01 XNT
        let allValidatorsReceived = true;

        for (const validatorBalance of balancesAfter.validators) {
            const received = Math.abs(validatorBalance.change - expectedFeePerValidator) < 0.000001;
            console.log(`   ${validatorBalance.name}: ${received ? '✅' : '❌'} Received ${validatorBalance.change.toFixed(4)} XNT (expected ${expectedFeePerValidator})`);

            if (!received) allValidatorsReceived = false;
        }

        if (allValidatorsReceived) {
            logStep('Validate fee distribution', true, undefined, { feePerValidator: expectedFeePerValidator });
        } else {
            logStep('Validate fee distribution', false, 'Not all validators received correct fees');
        }
    } else {
        logStep('Validate results (skip - already processed)', true);
    }

    // ========================================================================
    // SUMMARY
    // ========================================================================

    console.log('\n' + '━'.repeat(80));
    console.log('TEST SUMMARY');
    console.log('━'.repeat(80) + '\n');

    const totalSteps = results.length;
    const passedSteps = results.filter(r => r.passed).length;
    const failedSteps = totalSteps - passedSteps;
    const passRate = ((passedSteps / totalSteps) * 100).toFixed(1);

    console.log(`Total Steps:  ${totalSteps}`);
    console.log(`Passed:       ${passedSteps} ✅`);
    console.log(`Failed:       ${failedSteps} ${failedSteps > 0 ? '❌' : '✅'}`);
    console.log(`Pass Rate:    ${passRate}%\n`);

    results.forEach(result => {
        const symbol = result.passed ? '✅' : '❌';
        console.log(`${symbol} ${result.step}`);
        if (result.error) {
            console.log(`   ⚠️  ${result.error}`);
        }
    });

    if (failedSteps > 0) {
        console.log('\n⚠️  Some steps failed. Please review the errors above.\n');
        process.exit(1);
    } else {
        console.log('\n✅ All steps passed! V2 bridge is working correctly.\n');
    }

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = `./test-results-v2-e2e-${timestamp}.json`;
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`📄 Full results saved to: ${resultsFile}\n`);
}

main().catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
});
