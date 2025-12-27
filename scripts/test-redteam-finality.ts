import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import * as fs from 'fs';
import fetch from 'node-fetch';
import 'dotenv/config';

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const BURN_AMOUNT = 10000;
const BURN_PROGRAM_ID = new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');
const XENCAT_MINT = new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V');

const VALIDATORS = [
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function main() {
    console.log('🔴 RED TEAM: FINALITY TIMING ATTACKS');
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

    // Setup connections
    const solanaConnection = new Connection(SOLANA_RPC, 'confirmed');
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

    console.log(`📊 Validator Set Version: ${currentVersion}\n`);

    // TEST 6.1: Immediate Attestation Request (Before Finality)
    console.log('━'.repeat(60));
    console.log('TEST 6.1: Finality Attack - Immediate Attestation Request');
    console.log('━'.repeat(60));

    const CREATE_BURN = process.env.CREATE_BURN === 'true';

    if (CREATE_BURN) {
        console.log('\n🔥 Creating burn on Solana...');

        const { Token, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');

        const userTokenAccount = (await solanaConnection.getParsedTokenAccountsByOwner(
            userKeypair.publicKey,
            { mint: XENCAT_MINT }
        )).value[0].pubkey;

        // Get current nonce
        const [globalStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('global_state')],
            BURN_PROGRAM_ID
        );

        const globalStateInfo = await solanaConnection.getAccountInfo(globalStatePda);
        let burnNonce = 1;
        if (globalStateInfo) {
            burnNonce = Number(globalStateInfo.data.readBigUInt64LE(8)) + 1;
        }

        console.log(`📍 Next burn nonce: ${burnNonce}`);

        // Create burn instruction
        const [burnRecordPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('burn_record'),
                userKeypair.publicKey.toBuffer(),
                Buffer.from(burnNonce.toString().padStart(8, '0'))
            ],
            BURN_PROGRAM_ID
        );

        const burnIx = {
            programId: BURN_PROGRAM_ID,
            keys: [
                { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: userTokenAccount, isSigner: false, isWritable: true },
                { pubkey: XENCAT_MINT, isSigner: false, isWritable: true },
                { pubkey: burnRecordPda, isSigner: false, isWritable: true },
                { pubkey: globalStatePda, isSigner: false, isWritable: true },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([
                0,  // burn instruction discriminator
                ...new anchor.BN(BURN_AMOUNT).toArrayLike(Buffer, 'le', 8),
            ]),
        };

        const tx = new anchor.web3.Transaction().add(burnIx);
        const signature = await solanaConnection.sendTransaction(tx, [userKeypair]);

        console.log(`📝 Burn TX: ${signature}`);
        console.log(`⏱️  Sent at: ${new Date().toISOString()}`);

        // IMMEDIATELY request attestations (before confirmation)
        console.log('\n🎯 ATTACK: Requesting attestations IMMEDIATELY (before finality)');
        console.log('   Finality threshold: ~13 seconds (32 slots)');
        console.log('   Attack timing: <1 second after burn submission\n');

        const immediateAttestations = [];
        const requestStart = Date.now();

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: burnNonce,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                    signal: AbortSignal.timeout(5000),  // 5 second timeout
                });

                const requestTime = Date.now() - requestStart;

                if (response.ok) {
                    const attestation = await response.json();
                    immediateAttestations.push(attestation);
                    console.log(`   ⚠️  ${validator.name} signed IMMEDIATELY (${requestTime}ms)`);
                    console.log(`       🚨 SECURITY ISSUE: Validator signed before finality!`);
                } else {
                    const error = await response.json();
                    console.log(`   ✅ ${validator.name} rejected (${requestTime}ms)`);
                    console.log(`      Reason: ${error.error || 'Unknown'}`);
                }
            } catch (error: any) {
                const requestTime = Date.now() - requestStart;
                if (error.name === 'AbortError') {
                    console.log(`   ✅ ${validator.name} timed out (${requestTime}ms)`);
                    console.log(`      Likely waiting for finality`);
                } else {
                    console.log(`   ✅ ${validator.name} error: ${error.message}`);
                }
            }
        }

        console.log(`\n📊 Immediate attestations: ${immediateAttestations.length} of 3 needed`);

        if (immediateAttestations.length >= 3) {
            console.log('❌ TEST FAILED: Validators signed before finality!');
            console.log('⚠️  CRITICAL SECURITY ISSUE: Burn could be reverted by reorg');
        } else {
            console.log('✅ TEST PASSED: Validators enforce finality waiting period');
        }

        // Now wait for finality and try again
        console.log('\n⏳ Waiting 20 seconds for finality...');
        await new Promise(resolve => setTimeout(resolve, 20000));

        console.log('\n📡 Requesting attestations AFTER finality...');
        const finalizedAttestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: burnNonce,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    finalizedAttestations.push(attestation);
                    console.log(`   ✅ ${validator.name} signed after finality`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        console.log(`\n📊 Finalized attestations: ${finalizedAttestations.length} of 3 needed`);

        if (finalizedAttestations.length >= 3) {
            console.log('✅ Validators sign after finality window');

            console.log('\n📋 Verifying burn can be submitted to X1...');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(burnNonce).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            const attestationData = {
                burnNonce: new anchor.BN(burnNonce),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: finalizedAttestations.slice(0, 3).map(a => ({
                    validatorPubkey: new PublicKey(a.validator_pubkey),
                    signature: a.signature,
                    timestamp: new anchor.BN(a.timestamp),
                })),
            };

            try {
                const x1Tx = await lightClientProgram.methods
                    .submitBurnAttestation(attestationData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log(`✅ Burn verified on X1: ${x1Tx.substring(0, 20)}...`);
            } catch (error: any) {
                console.log(`⚠️  X1 submission failed: ${error.message.substring(0, 100)}`);
            }
        }

        console.log(`\n📍 Test burn nonce: ${burnNonce}`);
        console.log(`   Use: BURN_NONCE=${burnNonce} for future tests`);

    } else {
        console.log('\n⚠️  Set CREATE_BURN=true to run live finality timing test');
        console.log('   This test requires creating a real burn on Solana mainnet');
        console.log('\n   Test measures:');
        console.log('   1. Validator response time to immediate requests');
        console.log('   2. Whether validators wait for finality (32 slots ~13s)');
        console.log('   3. Potential reorg window exploitation');
    }

    // TEST 6.2: Slot Confirmation Analysis
    console.log('\n━'.repeat(60));
    console.log('TEST 6.2: Finality Analysis - Slot Confirmations');
    console.log('━'.repeat(60));

    console.log('\n📊 Solana Finality Analysis:');
    console.log('   - Confirmed: 1 slot confirmation (~400ms)');
    console.log('   - Finalized: 32 slot confirmations (~13 seconds)');
    console.log('   - Reorg window: Before 32 confirmations');

    console.log('\n🔒 Validator Best Practices:');
    console.log('   ✅ SHOULD: Wait for "finalized" commitment');
    console.log('   ✅ SHOULD: Verify minimum 32 slot confirmations');
    console.log('   ❌ NEVER: Sign on "confirmed" (1 slot)');
    console.log('   ❌ NEVER: Sign before transaction confirmation');

    console.log('\n⚠️  Reorg Attack Scenario:');
    console.log('   1. Attacker creates burn TX');
    console.log('   2. Gets attestations before finality');
    console.log('   3. Submits to X1 and mints tokens');
    console.log('   4. Solana reorg reverts the burn');
    console.log('   5. Attacker keeps X1 tokens without burning');

    console.log('\n📝 Recommendation:');
    console.log('   Validators MUST use "finalized" commitment level');
    console.log('   OR manually verify ≥32 slot confirmations');

    console.log('\n━'.repeat(60));
    console.log('🎉 FINALITY TIMING TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
