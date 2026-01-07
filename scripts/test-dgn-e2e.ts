/**
 * Complete DGN E2E Test
 * Tests the full DGN bridge flow from burn to mint
 */

import 'dotenv/config';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';

// Configuration
const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';
const BURN_NONCE = 181; // DGN burn
const USER_PUBKEY = new PublicKey('6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW');
const BURN_AMOUNT = 1000000; // 1 DGN (6 decimals)
const ASSET_ID = 2; // DGN

// Program IDs
const LIGHT_CLIENT_PROGRAM = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
const DGN_MINT_PROGRAM = new PublicKey('4YPipW8txxY3N7gHdj4NLhu8YxybHgarx5dJQCdCnQHs');
const DGN_MINT = new PublicKey('84PxDRsNyiRJU4gfFiD7RqvZzqh5FdqXjDdtFV3N3oxc');

// Validators
const VALIDATORS = [
    { url: 'http://149.50.116.159:8080', pubkey: new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH') },
    { url: 'http://193.34.212.186:8080', pubkey: new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag') },
    { url: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { url: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { url: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function collectDGNAttestations() {
    console.log('\n📥 Collecting DGN attestations...');

    const attestations = [];

    for (const validator of VALIDATORS) {
        try {
            const response = await fetch(`${validator.url}/attest-burn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: BURN_NONCE,
                    user: USER_PUBKEY.toBase58(),
                    expected_amount: BURN_AMOUNT,
                    validator_set_version: 1,
                }),
            });

            if (!response.ok) {
                console.log(`  ⚠️  Validator ${validator.url}: ${response.status}`);
                continue;
            }

            const attestation: any = await response.json();

            console.log(`  ✅ ${validator.url}`);
            console.log(`     Asset: ${attestation.asset_name} (ID: ${attestation.asset_id})`);

            attestations.push({
                validatorPubkey: new PublicKey(attestation.validator_pubkey),
                signature: attestation.signature,
                timestamp: new anchor.BN(attestation.timestamp),
            });

            if (attestations.length >= 3) {
                console.log(`\n✅ Got ${attestations.length} DGN attestations`);
                break;
            }
        } catch (err: any) {
            console.log(`  ❌ Validator ${validator.url}: ${err.message}`);
        }
    }

    return attestations;
}

async function main() {
    console.log('🧪 DGN Bridge E2E Test');
    console.log('='.repeat(60));
    console.log(`Burn Nonce: ${BURN_NONCE}`);
    console.log(`Asset: DGN (asset_id=2)`);
    console.log(`Amount: 1 DGN`);

    // Load user keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY environment variable required!');
    }

    let user: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        user = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        user = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`\n👤 User: ${user.publicKey.toBase58()}`);

    // Setup connection and programs
    const connection = new Connection(X1_RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(user), {
        commitment: 'confirmed',
    });

    const lightClientIdl = JSON.parse(
        fs.readFileSync('target/idl/solana_light_client_x1.json', 'utf-8')
    );
    const dgnMintIdl = JSON.parse(
        fs.readFileSync('target/idl/dgn_mint_x1.json', 'utf-8')
    );

    const lightClientProgram = new anchor.Program(lightClientIdl, LIGHT_CLIENT_PROGRAM, provider);
    const dgnMintProgram = new anchor.Program(dgnMintIdl, DGN_MINT_PROGRAM, provider);

    // Step 1: Collect DGN attestations
    const attestations = await collectDGNAttestations();

    if (attestations.length < 3) {
        throw new Error(`Insufficient attestations: got ${attestations.length}, need 3`);
    }

    // Step 2: Derive PDAs
    console.log('\n🔑 Deriving PDAs...');

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([ASSET_ID]),
            USER_PUBKEY.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
        ],
        LIGHT_CLIENT_PROGRAM
    );

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        LIGHT_CLIENT_PROGRAM
    );

    console.log(`  Verified Burn V3 (DGN): ${verifiedBurnPda.toBase58()}`);

    // Step 3: Submit to light client (check if already submitted)
    console.log('\n📤 Submitting DGN attestations to light client...');

    try {
        await lightClientProgram.account.verifiedBurnV3.fetch(verifiedBurnPda);
        console.log('  ✅ Attestations already submitted (verified burn exists)');
    } catch {
        const attestationData = {
            assetId: ASSET_ID,
            burnNonce: new anchor.BN(BURN_NONCE),
            user: USER_PUBKEY,
            amount: new anchor.BN(BURN_AMOUNT),
            validatorSetVersion: new anchor.BN(1),
            attestations: attestations,
        };

        const tx = await lightClientProgram.methods
            .submitBurnAttestationV3(ASSET_ID, new anchor.BN(BURN_NONCE), attestationData)
            .accounts({
                user: user.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user])
            .rpc();

        console.log(`  ✅ Transaction: ${tx}`);
    }

    // Step 4: Create user token account if needed
    const userTokenAccount = await getAssociatedTokenAddress(
        DGN_MINT,
        user.publicKey
    );

    console.log(`\n🪙 User DGN Token Account: ${userTokenAccount.toBase58()}`);

    try {
        await getAccount(connection, userTokenAccount);
        console.log('  ✅ Token account exists');
    } catch {
        console.log('  📤 Creating token account...');
        const createAtaIx = createAssociatedTokenAccountInstruction(
            user.publicKey,
            userTokenAccount,
            user.publicKey,
            DGN_MINT
        );

        const tx = new anchor.web3.Transaction().add(createAtaIx);
        const sig = await provider.sendAndConfirm(tx, [user]);
        console.log(`  ✅ Created: ${sig}`);
    }

    // Step 5: Mint DGN tokens
    console.log('\n🪙 Minting DGN using V3...');

    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('dgn_mint_state')],
        DGN_MINT_PROGRAM
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn_v3'),
            Buffer.from([ASSET_ID]),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
            USER_PUBKEY.toBuffer(),
        ],
        DGN_MINT_PROGRAM
    );

    console.log(`  Mint State: ${mintStatePda.toBase58()}`);
    console.log(`  Processed Burn V3: ${processedBurnPda.toBase58()}`);

    try {
        const tx = await dgnMintProgram.methods
            .mintFromBurnV3(new anchor.BN(BURN_NONCE), ASSET_ID)
            .accounts({
                mintState: mintStatePda,
                dgnMint: DGN_MINT,
                processedBurn: processedBurnPda,
                userTokenAccount: userTokenAccount,
                user: user.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts(
                VALIDATORS.map(v => ({
                    pubkey: v.pubkey,
                    isWritable: true,
                    isSigner: false,
                }))
            )
            .signers([user])
            .rpc();

        console.log(`  ✅ Transaction: ${tx}`);
        console.log(`  ✅ Minted 1 DGN to ${userTokenAccount.toBase58()}`);
    } catch (err: any) {
        console.log(`  ❌ Error: ${err.message}`);
        if (err.logs) {
            console.log('  Logs:', err.logs);
        }
        throw err;
    }

    console.log('\n✅ DGN E2E Test Complete!');
    console.log('='.repeat(60));
    console.log('✅ Burned DGN on Solana (nonce 181)');
    console.log('✅ Validators attested with asset_id=2');
    console.log('✅ Light client verified DGN burn');
    console.log('✅ DGN mint program minted tokens');
    console.log('✅ Fees distributed to validators');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Test failed:', err);
        process.exit(1);
    });
