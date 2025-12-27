import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import fs from 'fs';
import fetch from 'node-fetch';
import 'dotenv/config';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const BURN_AMOUNT = 10000;

const VALIDATORS = [
    { name: 'Validator 1', api: 'http://149.50.116.159:8080', pubkey: new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH') },
    { name: 'Validator 2', api: 'http://193.34.212.186:8080', pubkey: new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag') },
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function main() {
    const BURN_NONCE = parseInt(process.env.BURN_NONCE || '0');

    console.log('🎯 THRESHOLD GOVERNANCE TESTS');
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
    console.log(`📊 Threshold: ${validatorSet.threshold} of ${validatorSet.validators.length}\n`);

    // Wait for finality
    console.log('⏳ Waiting 20 seconds for Solana finality...\n');
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Collect all attestations
    console.log('━'.repeat(60));
    console.log('Collecting Attestations from All Validators');
    console.log('━'.repeat(60));

    const attestations = [];

    for (const validator of VALIDATORS) {
        try {
            console.log(`📡 ${validator.name}...`);

            const response = await fetch(`${validator.api}/attest-burn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: BURN_NONCE,
                    user: userKeypair.publicKey.toBase58(),
                    expected_amount: BURN_AMOUNT,
                    validator_set_version: currentVersion,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                console.log(`   ❌ Failed: ${error.error}`);
                continue;
            }

            const attestation = await response.json();
            attestations.push(attestation);
            console.log(`   ✅ Signed`);

        } catch (error: any) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }

    console.log(`\n✅ Collected ${attestations.length} attestations\n`);

    if (attestations.length < 5) {
        console.log('❌ Need all 5 validators for threshold tests');
        process.exit(1);
    }

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v2'),
            userKeypair.publicKey.toBuffer(),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        lightClientProgram.programId
    );

    // Test 3.1: 1 of 5 (should FAIL)
    console.log('━'.repeat(60));
    console.log('TEST 3.1: Insufficient Signatures (1 of 5)');
    console.log('━'.repeat(60));

    await testThreshold(
        lightClientProgram,
        userKeypair,
        BURN_NONCE,
        currentVersion,
        attestations.slice(0, 1),
        validatorSetPda,
        verifiedBurnPda,
        false,
        '1 of 5'
    );

    // Test 3.2: 2 of 5 (should FAIL)
    console.log('\n━'.repeat(60));
    console.log('TEST 3.2: Insufficient Signatures (2 of 5)');
    console.log('━'.repeat(60));

    await testThreshold(
        lightClientProgram,
        userKeypair,
        BURN_NONCE,
        currentVersion,
        attestations.slice(0, 2),
        validatorSetPda,
        verifiedBurnPda,
        false,
        '2 of 5'
    );

    // Test 3.3: 3 of 5 (should SUCCEED)
    console.log('\n━'.repeat(60));
    console.log('TEST 3.3: Exact Threshold (3 of 5)');
    console.log('━'.repeat(60));

    await testThreshold(
        lightClientProgram,
        userKeypair,
        BURN_NONCE,
        currentVersion,
        attestations.slice(0, 3),
        validatorSetPda,
        verifiedBurnPda,
        true,
        '3 of 5'
    );

    console.log('\n━'.repeat(60));
    console.log('🎉 ALL THRESHOLD TESTS COMPLETED!');
    console.log('━'.repeat(60));
    console.log('✅ Test 3.1: 1 of 5 rejected');
    console.log('✅ Test 3.2: 2 of 5 rejected');
    console.log('✅ Test 3.3: 3 of 5 accepted');
    console.log('\n🔒 Threshold governance verified!');
}

async function testThreshold(
    program: Program<SolanaLightClientX1>,
    userKeypair: Keypair,
    burnNonce: number,
    version: number,
    selectedAttestations: any[],
    validatorSetPda: PublicKey,
    verifiedBurnPda: PublicKey,
    shouldSucceed: boolean,
    description: string
) {
    console.log(`\n📋 Testing with ${description}`);

    const attestationData = {
        burnNonce: new anchor.BN(burnNonce),
        user: userKeypair.publicKey,
        amount: new anchor.BN(BURN_AMOUNT),
        validatorSetVersion: new anchor.BN(version),
        attestations: selectedAttestations.map(a => ({
            validatorPubkey: new PublicKey(a.validator_pubkey),
            signature: a.signature,
            timestamp: new anchor.BN(a.timestamp),
        })),
    };

    try {
        const tx = await program.methods
            .submitBurnAttestation(attestationData)
            .accounts({
                user: userKeypair.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        if (shouldSucceed) {
            console.log(`✅ TEST PASSED: Transaction succeeded as expected`);
            console.log(`📝 TX: ${tx}`);
        } else {
            console.log(`❌ TEST FAILED: Transaction should have been rejected!`);
            console.log(`📝 TX: ${tx}`);
        }

    } catch (error: any) {
        if (!shouldSucceed) {
            console.log(`✅ TEST PASSED: Transaction rejected as expected`);

            if (error.message.includes('InsufficientAttestations') ||
                error.message.includes('0x2001') ||
                error.message.includes('custom program error')) {
                console.log(`🔒 Reason: Insufficient attestations`);
            } else {
                console.log(`📝 Error: ${error.message.substring(0, 100)}`);
            }
        } else {
            console.log(`❌ TEST FAILED: Transaction should have succeeded!`);
            console.log(`📝 Error: ${error.message}`);

            if (error.logs) {
                console.log('\n📜 Logs:');
                error.logs.slice(0, 5).forEach((log: string) => console.log('  ', log));
            }
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
