import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import * as fs from 'fs';
import 'dotenv/config';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';

// Fuzzing configuration
const FUZZ_ITERATIONS = parseInt(process.env.FUZZ_ITERATIONS || '100');
const FUZZ_SEED = parseInt(process.env.FUZZ_SEED || Date.now().toString());

// Simple PRNG for reproducible fuzzing
class FuzzRandom {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    next(): number {
        // Linear congruential generator
        this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
        return this.seed;
    }

    nextInt(min: number, max: number): number {
        return min + (this.next() % (max - min + 1));
    }

    nextBool(): boolean {
        return this.next() % 2 === 0;
    }

    nextBytes(length: number): Buffer {
        const bytes = Buffer.alloc(length);
        for (let i = 0; i < length; i++) {
            bytes[i] = this.next() % 256;
        }
        return bytes;
    }

    shuffle<T>(array: T[]): T[] {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
}

async function main() {
    console.log('🔴 RED TEAM: FUZZING FRAMEWORK');
    console.log('━'.repeat(60));
    console.log(`🎲 Seed: ${FUZZ_SEED}`);
    console.log(`🔢 Iterations: ${FUZZ_ITERATIONS}`);
    console.log('━'.repeat(60));

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

    // Load light client program
    const lightClientProgramId = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
    const lightClientIdl = JSON.parse(fs.readFileSync('./target/idl/solana_light_client_x1.json', 'utf-8'));
    const lightClientProgram = new Program(lightClientIdl, lightClientProgramId, x1Provider) as Program<SolanaLightClientX1>;

    // Get validator set
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        lightClientProgram.programId
    );

    const validatorSet = await lightClientProgram.account.x1ValidatorSet.fetch(validatorSetPda);
    const currentVersion = validatorSet.version.toNumber();

    console.log(`📊 Validator Set Version: ${currentVersion}`);
    console.log(`🔐 Validators: ${validatorSet.validators.length}`);
    console.log(`🎯 Threshold: ${validatorSet.threshold}\n`);

    // Initialize fuzzer
    const fuzzer = new FuzzRandom(FUZZ_SEED);

    // Fuzzing statistics
    const stats = {
        total: 0,
        rejected: 0,
        errors: new Map<string, number>(),
        crashes: 0,
        invariantViolations: 0,
        unexpectedSuccess: 0,
    };

    console.log('━'.repeat(60));
    console.log('FUZZ TEST 1: Random Burn Attestation Data');
    console.log('━'.repeat(60));
    console.log();

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
        stats.total++;

        // Generate random attestation data
        const randomNonce = fuzzer.nextInt(0, 1000000000);
        const randomAmount = fuzzer.nextInt(0, 1000000000);
        const randomVersion = fuzzer.nextInt(0, 100);
        const randomAttestationCount = fuzzer.nextInt(0, 10);

        // Generate random attestations
        const randomAttestations = [];
        for (let j = 0; j < randomAttestationCount; j++) {
            randomAttestations.push({
                validatorPubkey: new PublicKey(fuzzer.nextBytes(32)),
                signature: Array.from(fuzzer.nextBytes(64)),
                timestamp: new anchor.BN(fuzzer.nextInt(0, Date.now())),
            });
        }

        // Generate random user
        const randomUser = new PublicKey(fuzzer.nextBytes(32));

        const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v2'),
                randomUser.toBuffer(),
                new anchor.BN(randomNonce).toArrayLike(Buffer, 'le', 8),
            ],
            lightClientProgram.programId
        );

        const fuzzData = {
            burnNonce: new anchor.BN(randomNonce),
            user: randomUser,
            amount: new anchor.BN(randomAmount),
            validatorSetVersion: new anchor.BN(randomVersion),
            attestations: randomAttestations,
        };

        try {
            // Attempt to submit random data
            await lightClientProgram.methods
                .submitBurnAttestation(fuzzData)
                .accounts({
                    user: userKeypair.publicKey,  // Real signer
                    validatorSet: validatorSetPda,
                    verifiedBurn: verifiedBurnPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            // If this succeeds, it's VERY bad (random data accepted!)
            stats.unexpectedSuccess++;
            console.log(`❌ ITERATION ${i + 1}: UNEXPECTED SUCCESS!`);
            console.log(`   Random data accepted! CRITICAL SECURITY ISSUE!`);
            console.log(`   Nonce: ${randomNonce}, Amount: ${randomAmount}, Version: ${randomVersion}`);
            console.log(`   Attestations: ${randomAttestationCount}`);
        } catch (error: any) {
            // Expected: random data should be rejected
            stats.rejected++;

            // Categorize error
            let errorType = 'Unknown';
            if (error.message.includes('threshold')) {
                errorType = 'InsufficientThreshold';
            } else if (error.message.includes('version')) {
                errorType = 'VersionMismatch';
            } else if (error.message.includes('signature')) {
                errorType = 'InvalidSignature';
            } else if (error.message.includes('validator')) {
                errorType = 'InvalidValidator';
            } else if (error.message.includes('duplicate')) {
                errorType = 'DuplicateValidator';
            } else if (error.message.includes('arithmetic')) {
                errorType = 'ArithmeticOverflow';
            } else if (error.message.includes('account')) {
                errorType = 'AccountError';
            } else if (error.message.includes('borsh')) {
                errorType = 'DeserializationError';
            }

            stats.errors.set(errorType, (stats.errors.get(errorType) || 0) + 1);

            if (i % 10 === 0) {
                process.stdout.write(`\r   Progress: ${i + 1}/${FUZZ_ITERATIONS} (${Math.floor((i + 1) / FUZZ_ITERATIONS * 100)}%)`);
            }
        }
    }

    console.log('\n');

    // FUZZ TEST 2: Attestation Array Fuzzing
    console.log('━'.repeat(60));
    console.log('FUZZ TEST 2: Attestation Array Edge Cases');
    console.log('━'.repeat(60));
    console.log();

    const arrayFuzzCases = [
        { name: 'Empty array', attestations: [] },
        { name: 'Single attestation', attestations: [1] },
        { name: 'Exactly threshold', attestations: [1, 2, 3] },
        { name: 'Below threshold', attestations: [1, 2] },
        { name: 'Above threshold', attestations: [1, 2, 3, 4, 5] },
        { name: 'Maximum array', attestations: Array(10).fill(1) },
        { name: 'Excessive array', attestations: Array(100).fill(1) },
    ];

    for (const testCase of arrayFuzzCases) {
        const randomNonce = fuzzer.nextInt(0, 1000000000);
        const randomUser = new PublicKey(fuzzer.nextBytes(32));

        const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v2'),
                randomUser.toBuffer(),
                new anchor.BN(randomNonce).toArrayLike(Buffer, 'le', 8),
            ],
            lightClientProgram.programId
        );

        const attestations = testCase.attestations.map(() => ({
            validatorPubkey: new PublicKey(fuzzer.nextBytes(32)),
            signature: Array.from(fuzzer.nextBytes(64)),
            timestamp: new anchor.BN(Date.now()),
        }));

        const fuzzData = {
            burnNonce: new anchor.BN(randomNonce),
            user: randomUser,
            amount: new anchor.BN(10000),
            validatorSetVersion: new anchor.BN(currentVersion),
            attestations,
        };

        try {
            await lightClientProgram.methods
                .submitBurnAttestation(fuzzData)
                .accounts({
                    user: userKeypair.publicKey,
                    validatorSet: validatorSetPda,
                    verifiedBurn: verifiedBurnPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log(`   ⚠️  ${testCase.name}: UNEXPECTED SUCCESS!`);
            stats.unexpectedSuccess++;
        } catch (error: any) {
            console.log(`   ✅ ${testCase.name}: Rejected as expected`);
            stats.rejected++;
        }
    }

    // FUZZ TEST 3: Integer Overflow/Underflow
    console.log('\n━'.repeat(60));
    console.log('FUZZ TEST 3: Integer Overflow/Underflow');
    console.log('━'.repeat(60));
    console.log();

    const maxU64 = BigInt('18446744073709551615');
    const integerFuzzCases = [
        { name: 'Zero nonce', nonce: 0 },
        { name: 'Max u64 nonce', nonce: maxU64 },
        { name: 'Zero amount', amount: 0 },
        { name: 'Max u64 amount', amount: maxU64 },
        { name: 'Zero version', version: 0 },
        { name: 'Max u64 version', version: maxU64 },
    ];

    for (const testCase of integerFuzzCases) {
        const nonce = testCase.nonce !== undefined ? testCase.nonce : fuzzer.nextInt(1000, 2000);
        const amount = testCase.amount !== undefined ? testCase.amount : 10000;
        const version = testCase.version !== undefined ? testCase.version : currentVersion;

        const randomUser = new PublicKey(fuzzer.nextBytes(32));

        const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v2'),
                randomUser.toBuffer(),
                new anchor.BN(nonce.toString()).toArrayLike(Buffer, 'le', 8),
            ],
            lightClientProgram.programId
        );

        const fuzzData = {
            burnNonce: new anchor.BN(nonce.toString()),
            user: randomUser,
            amount: new anchor.BN(amount.toString()),
            validatorSetVersion: new anchor.BN(version.toString()),
            attestations: [
                {
                    validatorPubkey: new PublicKey(fuzzer.nextBytes(32)),
                    signature: Array.from(fuzzer.nextBytes(64)),
                    timestamp: new anchor.BN(Date.now()),
                },
            ],
        };

        try {
            await lightClientProgram.methods
                .submitBurnAttestation(fuzzData)
                .accounts({
                    user: userKeypair.publicKey,
                    validatorSet: validatorSetPda,
                    verifiedBurn: verifiedBurnPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log(`   ⚠️  ${testCase.name}: UNEXPECTED SUCCESS!`);
            stats.unexpectedSuccess++;
        } catch (error: any) {
            if (error.message.includes('overflow') || error.message.includes('underflow')) {
                console.log(`   ✅ ${testCase.name}: Overflow protection working`);
            } else {
                console.log(`   ✅ ${testCase.name}: Rejected (${error.message.substring(0, 40)})`);
            }
            stats.rejected++;
        }
    }

    // FUZZ TEST 4: Signature Length Fuzzing
    console.log('\n━'.repeat(60));
    console.log('FUZZ TEST 4: Signature Length Edge Cases');
    console.log('━'.repeat(60));
    console.log();

    const signatureLengthCases = [
        { name: 'Empty signature', length: 0 },
        { name: 'Short signature', length: 32 },
        { name: 'Canonical length', length: 64 },
        { name: 'Long signature', length: 128 },
        { name: 'Excessive signature', length: 1000 },
    ];

    for (const testCase of signatureLengthCases) {
        const randomNonce = fuzzer.nextInt(0, 1000000);
        const randomUser = new PublicKey(fuzzer.nextBytes(32));

        const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v2'),
                randomUser.toBuffer(),
                new anchor.BN(randomNonce).toArrayLike(Buffer, 'le', 8),
            ],
            lightClientProgram.programId
        );

        try {
            const signature = Array.from(fuzzer.nextBytes(testCase.length));

            const fuzzData = {
                burnNonce: new anchor.BN(randomNonce),
                user: randomUser,
                amount: new anchor.BN(10000),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: [{
                    validatorPubkey: new PublicKey(fuzzer.nextBytes(32)),
                    signature,
                    timestamp: new anchor.BN(Date.now()),
                }],
            };

            await lightClientProgram.methods
                .submitBurnAttestation(fuzzData)
                .accounts({
                    user: userKeypair.publicKey,
                    validatorSet: validatorSetPda,
                    verifiedBurn: verifiedBurnPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log(`   ⚠️  ${testCase.name}: UNEXPECTED SUCCESS!`);
            stats.unexpectedSuccess++;
        } catch (error: any) {
            if (error.message.includes('borsh') || error.message.includes('deserialize')) {
                console.log(`   ✅ ${testCase.name}: Borsh validation working`);
            } else {
                console.log(`   ✅ ${testCase.name}: Rejected`);
            }
            stats.rejected++;
        }
    }

    // FUZZ TEST 5: Invariant Checks
    console.log('\n━'.repeat(60));
    console.log('FUZZ TEST 5: Invariant Verification');
    console.log('━'.repeat(60));
    console.log();

    // Check validator set invariants after all fuzzing
    const finalValidatorSet = await lightClientProgram.account.x1ValidatorSet.fetch(validatorSetPda);

    console.log('   Checking system invariants after fuzzing...');

    const inv1 = finalValidatorSet.validators.length >= finalValidatorSet.threshold;
    const inv2 = finalValidatorSet.threshold > 0;
    const inv3 = finalValidatorSet.version.toNumber() > 0;
    const inv4 = finalValidatorSet.version.toNumber() === currentVersion;  // No unauthorized updates

    console.log(`   INV1: validators.len >= threshold: ${inv1 ? '✅' : '❌'}`);
    console.log(`   INV2: threshold > 0: ${inv2 ? '✅' : '❌'}`);
    console.log(`   INV3: version > 0: ${inv3 ? '✅' : '❌'}`);
    console.log(`   INV4: version unchanged: ${inv4 ? '✅' : '❌'}`);

    if (!inv1 || !inv2 || !inv3 || !inv4) {
        stats.invariantViolations++;
        console.log('   🚨 CRITICAL: Invariant violation detected!');
    } else {
        console.log('   ✅ All invariants hold after fuzzing');
    }

    // Final Statistics
    console.log('\n━'.repeat(60));
    console.log('🎉 FUZZING COMPLETE!');
    console.log('━'.repeat(60));

    console.log(`\n📊 Statistics:`);
    console.log(`   Total tests: ${stats.total + arrayFuzzCases.length + integerFuzzCases.length + signatureLengthCases.length + 1}`);
    console.log(`   Rejected (expected): ${stats.rejected}`);
    console.log(`   Unexpected success: ${stats.unexpectedSuccess}`);
    console.log(`   Invariant violations: ${stats.invariantViolations}`);

    console.log('\n📋 Error Distribution:');
    const sortedErrors = Array.from(stats.errors.entries()).sort((a, b) => b[1] - a[1]);
    for (const [errorType, count] of sortedErrors) {
        const percentage = ((count / stats.rejected) * 100).toFixed(1);
        console.log(`   ${errorType}: ${count} (${percentage}%)`);
    }

    console.log('\n🎯 Security Assessment:');
    if (stats.unexpectedSuccess > 0) {
        console.log(`   ❌ FAILED: ${stats.unexpectedSuccess} random inputs accepted!`);
        console.log('   🚨 CRITICAL: Bridge accepts invalid data!');
    } else if (stats.invariantViolations > 0) {
        console.log('   ❌ FAILED: Invariant violations detected!');
        console.log('   🚨 CRITICAL: System state corrupted!');
    } else {
        console.log('   ✅ PASSED: All random inputs properly rejected');
        console.log('   ✅ All invariants maintained');
        console.log('   🔒 Bridge demonstrates robust input validation');
    }

    console.log(`\n💡 Reproducibility:`);
    console.log(`   Seed: ${FUZZ_SEED}`);
    console.log(`   Re-run: FUZZ_SEED=${FUZZ_SEED} FUZZ_ITERATIONS=${FUZZ_ITERATIONS} npx ts-node scripts/test-fuzzing.ts`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('💥 FUZZER CRASHED!');
        console.error(error);
        process.exit(1);
    });
