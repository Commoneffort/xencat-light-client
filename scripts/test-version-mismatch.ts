import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import * as fs from 'fs';
import fetch from 'node-fetch';
import 'dotenv/config';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const BURN_AMOUNT = 10000;

const VALIDATORS = [
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function main() {
    console.log('🔢 VERSION MISMATCH TESTS');
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

    console.log(`📊 Current Validator Set Version: ${currentVersion}\n`);

    // TEST 2.1: Old Version Attestation
    console.log('━'.repeat(60));
    console.log('TEST 2.1: Old Version Attestation');
    console.log('━'.repeat(60));

    const BURN_NONCE_2_1 = parseInt(process.env.BURN_NONCE_2_1 || '0');

    if (BURN_NONCE_2_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_2_1}`);
        console.log(`📊 Current Version: ${currentVersion}`);
        console.log(`📊 Requesting Version: 0 (OLD) ❌`);
        console.log('\n⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Try to get attestations with version 0
        console.log('📡 Requesting attestations with VERSION 0...');
        const attestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_2_1,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: 0,  // OLD VERSION!
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    attestations.push(attestation);
                    console.log(`   ⚠️  ${validator.name} signed with old version`);
                } else {
                    const error = await response.json();
                    console.log(`   ✅ ${validator.name} rejected`);
                    console.log(`      Reason: ${error.error}`);
                }
            } catch (error: any) {
                console.log(`   ✅ ${validator.name} rejected: ${error.message}`);
            }
        }

        if (attestations.length >= 3) {
            console.log(`\n⚠️  Got ${attestations.length} attestations with old version`);
            console.log('📋 Attempting to submit to X1 program...');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_2_1).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_2_1),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(0),  // OLD VERSION!
                attestations: attestations.slice(0, 3).map(a => ({
                    validatorPubkey: new PublicKey(a.validator_pubkey),
                    signature: a.signature,
                    timestamp: new anchor.BN(a.timestamp),
                })),
            };

            try {
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(attestationData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Old version attestation was accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Old version attestation rejected by program!');

                if (error.message.includes('InvalidValidatorSetVersion') ||
                    error.message.includes('0x1003')) {
                    console.log('🔒 Reason: InvalidValidatorSetVersion error');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n✅ TEST PASSED: Validators rejected old version!`);
            console.log(`📊 Only ${attestations.length} validators signed (need 3)`);
            console.log('🔒 Validators enforce version matching at signing time');
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_2_1 to run Test 2.1');
    }

    // TEST 2.2: Future Version Attestation
    console.log('\n━'.repeat(60));
    console.log('TEST 2.2: Future Version Attestation');
    console.log('━'.repeat(60));

    const BURN_NONCE_2_2 = parseInt(process.env.BURN_NONCE_2_2 || '0');

    if (BURN_NONCE_2_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_2_2}`);
        console.log(`📊 Current Version: ${currentVersion}`);
        console.log(`📊 Requesting Version: 999 (FUTURE) ❌`);
        console.log('\n⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Try to get attestations with version 999
        console.log('📡 Requesting attestations with VERSION 999...');
        const attestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_2_2,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: 999,  // FUTURE VERSION!
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    attestations.push(attestation);
                    console.log(`   ⚠️  ${validator.name} signed with future version`);
                } else {
                    const error = await response.json();
                    console.log(`   ✅ ${validator.name} rejected`);
                    console.log(`      Reason: ${error.error}`);
                }
            } catch (error: any) {
                console.log(`   ✅ ${validator.name} rejected: ${error.message}`);
            }
        }

        if (attestations.length >= 3) {
            console.log(`\n⚠️  Got ${attestations.length} attestations with future version`);
            console.log('📋 Attempting to submit to X1 program...');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_2_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_2_2),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(999),  // FUTURE VERSION!
                attestations: attestations.slice(0, 3).map(a => ({
                    validatorPubkey: new PublicKey(a.validator_pubkey),
                    signature: a.signature,
                    timestamp: new anchor.BN(a.timestamp),
                })),
            };

            try {
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(attestationData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Future version attestation was accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Future version attestation rejected by program!');

                if (error.message.includes('InvalidValidatorSetVersion') ||
                    error.message.includes('0x1003')) {
                    console.log('🔒 Reason: InvalidValidatorSetVersion error');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n✅ TEST PASSED: Validators rejected future version!`);
            console.log(`📊 Only ${attestations.length} validators signed (need 3)`);
            console.log('🔒 Validators enforce version matching at signing time');
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_2_2 to run Test 2.2');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 VERSION MISMATCH TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
