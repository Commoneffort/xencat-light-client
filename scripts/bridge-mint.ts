/**
 * Universal Bridge Mint Script
 *
 * Mints tokens on X1 from Solana burns (works for any asset)
 *
 * Usage:
 *   BURN_NONCE=182 ASSET_ID=2 npx ts-node scripts/bridge-mint.ts
 *   BURN_NONCE=180 ASSET_ID=1 npx ts-node scripts/bridge-mint.ts
 *
 * Environment Variables:
 *   BURN_NONCE - Required: The burn nonce from Solana
 *   ASSET_ID - Required: 1 for XENCAT, 2 for DGN
 *   USER_PRIVATE_KEY - Required: User's private key
 *   X1_RPC - Optional: X1 RPC endpoint (default: https://rpc.mainnet.x1.xyz)
 */

import 'dotenv/config';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, getAccount, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';

// Configuration
const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';
const BURN_NONCE = parseInt(process.env.BURN_NONCE || '0');
const ASSET_ID = parseInt(process.env.ASSET_ID || '0');

if (!BURN_NONCE || !ASSET_ID) {
    console.error('❌ Missing required environment variables:');
    console.error('   BURN_NONCE - The burn nonce from Solana');
    console.error('   ASSET_ID - 1 for XENCAT, 2 for DGN');
    console.error('\nExample:');
    console.error('   BURN_NONCE=182 ASSET_ID=2 npx ts-node scripts/bridge-mint.ts');
    process.exit(1);
}

// Asset configuration
const ASSETS = {
    1: {
        name: 'XENCAT',
        mintProgram: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
        mint: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),
        mintStateSeed: 'mint_state_v2',
    },
    2: {
        name: 'DGN',
        mintProgram: new PublicKey('4YPipW8txxY3N7gHdj4NLhu8YxybHgarx5dJQCdCnQHs'),
        mint: new PublicKey('84PxDRsNyiRJU4gfFiD7RqvZzqh5FdqXjDdtFV3N3oxc'),
        mintStateSeed: 'dgn_mint_state',
    },
} as const;

const asset = ASSETS[ASSET_ID as keyof typeof ASSETS];
if (!asset) {
    console.error(`❌ Invalid ASSET_ID: ${ASSET_ID}`);
    console.error('   Valid values: 1 (XENCAT), 2 (DGN)');
    process.exit(1);
}

// Program IDs
const LIGHT_CLIENT_PROGRAM = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');

// Validators
const VALIDATORS = [
    { url: 'http://149.50.116.159:8080', pubkey: new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH') },
    { url: 'http://193.34.212.186:8080', pubkey: new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag') },
    { url: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { url: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { url: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function collectAttestations(burnNonce: number, user: PublicKey, expectedAmount: number) {
    console.log('📥 Collecting attestations from validators...');
    const attestations = [];

    for (const validator of VALIDATORS) {
        try {
            const response = await fetch(`${validator.url}/attest-burn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: burnNonce,
                    user: user.toBase58(),
                    expected_amount: expectedAmount,
                    validator_set_version: 1,
                }),
            });

            if (!response.ok) {
                console.log(`  ⚠️  ${validator.url}: HTTP ${response.status}`);
                continue;
            }

            const attestation: any = await response.json();
            console.log(`  ✅ ${validator.url} - ${attestation.asset_name} (asset_id=${attestation.asset_id})`);

            attestations.push({
                validatorPubkey: new PublicKey(attestation.validator_pubkey),
                signature: attestation.signature,
                timestamp: new anchor.BN(attestation.timestamp),
            });

            if (attestations.length >= 3) {
                console.log(`\n✅ Collected ${attestations.length} attestations (threshold reached)`);
                break;
            }
        } catch (err: any) {
            console.log(`  ❌ ${validator.url}: ${err.message}`);
        }
    }

    if (attestations.length < 3) {
        throw new Error(`Insufficient attestations: got ${attestations.length}, need 3`);
    }

    return attestations;
}

async function main() {
    console.log('🌉 Universal Bridge Mint Script');
    console.log('='.repeat(60));
    console.log(`Asset: ${asset.name} (asset_id=${ASSET_ID})`);
    console.log(`Burn Nonce: ${BURN_NONCE}`);
    console.log(`X1 RPC: ${X1_RPC}\n`);

    // Load user keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY environment variable required');
    }

    let user: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        user = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        user = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`👤 User: ${user.publicKey.toBase58()}\n`);

    // Setup connection and programs
    const connection = new Connection(X1_RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(user), {
        commitment: 'confirmed',
    });

    const lightClientIdl = JSON.parse(fs.readFileSync('target/idl/solana_light_client_x1.json', 'utf-8'));
    const mintIdl = JSON.parse(
        fs.readFileSync(
            ASSET_ID === 1
                ? 'target/idl/xencat_mint_x1.json'
                : 'target/idl/dgn_mint_x1.json',
            'utf-8'
        )
    );

    const lightClientProgram = new anchor.Program(lightClientIdl, LIGHT_CLIENT_PROGRAM, provider);
    const mintProgram = new anchor.Program(mintIdl, asset.mintProgram, provider);

    // Derive PDAs
    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([ASSET_ID]),
            user.publicKey.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
        ],
        LIGHT_CLIENT_PROGRAM
    );

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        LIGHT_CLIENT_PROGRAM
    );

    // Step 1: Check if burn is already verified, if not submit attestations
    console.log('🔍 Checking burn verification status...');
    let verifiedBurn: any;

    try {
        verifiedBurn = await lightClientProgram.account.verifiedBurnV3.fetch(verifiedBurnPda);
        console.log('✅ Burn already verified on light client');
        console.log(`   Amount: ${verifiedBurn.amount.toString()}`);
        console.log(`   User: ${verifiedBurn.user.toBase58()}\n`);
    } catch {
        console.log('📤 Burn not yet verified, collecting attestations...\n');

        // Check for manually specified amount
        let detectedAmount = process.env.EXPECTED_AMOUNT ? parseInt(process.env.EXPECTED_AMOUNT) : 0;

        if (detectedAmount) {
            console.log(`✅ Using specified amount: ${detectedAmount / 1_000_000} ${asset.name}\n`);
        } else {
            // Note: In production, the frontend should prompt user for expected amount
            // or query Solana directly for the burn record. For this script, we try
            // to collect attestations which will return the actual amount.
            console.log('⏳ Attempting to detect burn amount from validators...\n');
        }

        let attestations: any[] = [];

        // Try to auto-detect amount if not manually specified
        if (!detectedAmount) {
            // Try to collect attestations - validator will tell us the actual amount
            for (const validator of VALIDATORS) {
                try {
                    // First try without expected_amount to get error with actual amount
                    const response = await fetch(`${validator.url}/attest-burn`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            burn_nonce: BURN_NONCE,
                            user: user.publicKey.toBase58(),
                            expected_amount: 1, // Dummy value to trigger amount check
                            validator_set_version: 1,
                        }),
                    });

                    const result: any = await response.json();

                    if (result.error && result.error.includes('Amount mismatch')) {
                        // Parse actual amount from error message
                        const match = result.error.match(/expected (\d+), got (\d+)/);
                        if (match) {
                            detectedAmount = parseInt(match[2]);
                            console.log(`✅ Detected burn amount: ${detectedAmount / 1_000_000} ${asset.name}`);
                            break;
                        }
                    } else if (result.amount) {
                        // Validator returned the amount directly
                        detectedAmount = result.amount;
                        console.log(`✅ Detected burn amount: ${detectedAmount / 1_000_000} ${asset.name}`);
                        break;
                    }
                } catch (err) {
                    continue;
                }
            }

            if (!detectedAmount) {
                throw new Error('Could not detect burn amount. Please specify EXPECTED_AMOUNT environment variable.');
            }
        }

        // Now collect attestations with the correct amount
        attestations = await collectAttestations(BURN_NONCE, user.publicKey, detectedAmount);

        console.log('\n📤 Submitting attestations to light client...');

        const attestationData = {
            assetId: ASSET_ID,
            burnNonce: new anchor.BN(BURN_NONCE),
            user: user.publicKey,
            amount: new anchor.BN(detectedAmount),
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

        console.log(`✅ Attestations submitted: ${tx}\n`);

        verifiedBurn = await lightClientProgram.account.verifiedBurnV3.fetch(verifiedBurnPda);
    }

    // Step 2: Create token account if needed
    const userTokenAccount = await getAssociatedTokenAddress(asset.mint, user.publicKey);
    console.log(`🪙 Token Account: ${userTokenAccount.toBase58()}`);

    try {
        await getAccount(connection, userTokenAccount);
        console.log('✅ Token account exists\n');
    } catch {
        console.log('📤 Creating token account...');
        const createAtaIx = createAssociatedTokenAccountInstruction(
            user.publicKey,
            userTokenAccount,
            user.publicKey,
            asset.mint
        );

        const tx = new anchor.web3.Transaction().add(createAtaIx);
        const sig = await provider.sendAndConfirm(tx, [user]);
        console.log(`✅ Token account created: ${sig}\n`);
    }

    // Get balance before minting
    let balanceBefore = 0;
    try {
        const account = await getAccount(connection, userTokenAccount);
        balanceBefore = Number(account.amount);
    } catch {
        balanceBefore = 0;
    }

    // Step 3: Mint tokens
    console.log('🪙 Minting tokens...');

    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(asset.mintStateSeed)],
        asset.mintProgram
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn_v3'),
            Buffer.from([ASSET_ID]),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
            user.publicKey.toBuffer(),
        ],
        asset.mintProgram
    );

    const accounts: any = {
        mintState: mintStatePda,
        processedBurn: processedBurnPda,
        userTokenAccount: userTokenAccount,
        user: user.publicKey,
        validatorSet: validatorSetPda,
        verifiedBurn: verifiedBurnPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
    };

    // Asset-specific mint account name
    if (ASSET_ID === 1) {
        accounts.xencatMint = asset.mint;
    } else {
        accounts.dgnMint = asset.mint;
    }

    const tx = await mintProgram.methods
        .mintFromBurnV3(new anchor.BN(BURN_NONCE), ASSET_ID)
        .accounts(accounts)
        .remainingAccounts(VALIDATORS.map(v => ({ pubkey: v.pubkey, isWritable: true, isSigner: false })))
        .signers([user])
        .rpc();

    console.log(`✅ Minting transaction: ${tx}`);

    // Get balance after minting
    const accountAfter = await getAccount(connection, userTokenAccount);
    const balanceAfter = Number(accountAfter.amount);
    const minted = (balanceAfter - balanceBefore) / 1_000_000;

    console.log('\n' + '='.repeat(60));
    console.log('✅ BRIDGE MINT SUCCESSFUL!');
    console.log('='.repeat(60));
    console.log(`Asset: ${asset.name} (asset_id=${ASSET_ID})`);
    console.log(`Minted: ${minted} ${asset.name}`);
    console.log(`New Balance: ${balanceAfter / 1_000_000} ${asset.name}`);
    console.log(`Token Account: ${userTokenAccount.toBase58()}`);
    console.log(`Burn Nonce: ${BURN_NONCE} (processed)`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Bridge mint failed:', err);
        process.exit(1);
    });
