import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';

const BURN_NONCE = parseInt(process.env.BURN_NONCE || '38');

// Validator endpoints
const VALIDATORS = [
    { url: 'http://149.50.116.159:8080', pubkey: '9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH' },
    { url: 'http://193.34.212.186:8080', pubkey: '8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag' },
    { url: 'http://74.50.76.62:10001', pubkey: '5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um' },
];

async function main() {
    console.log('\n🌉 COMPLETE BRIDGE FLOW - NONCE', BURN_NONCE, '\n');

    // Load keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY!;
    let userKeypair: Keypair;
    try {
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKeyEnv)));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`👤 User: ${userKeypair.publicKey.toBase58()}\n`);

    const x1Connection = new Connection('https://rpc.mainnet.x1.xyz', 'confirmed');

    const lightClientProgramId = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
    const mintProgramId = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Collect Attestations from Validators
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━ STEP 1: Collect Validator Attestations ━━━━\n');

    const attestationPromises = VALIDATORS.map(async (validator) => {
        try {
            console.log(`📡 Requesting from ${validator.url}...`);
            const response = await fetch(validator.url + '/attest-burn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: BURN_NONCE,
                    user: userKeypair.publicKey.toBase58(),
                    expected_amount: 10000,
                    validator_set_version: 1,
                }),
            });

            if (!response.ok) {
                console.log(`❌ Failed: ${await response.text()}`);
                return null;
            }

            const attestation = await response.json();
            console.log(`✅ Signed by ${validator.pubkey.slice(0, 8)}...`);
            return attestation;
        } catch (error: any) {
            console.log(`❌ Error: ${error.message}`);
            return null;
        }
    });

    const attestations = (await Promise.all(attestationPromises)).filter(a => a !== null);

    console.log(`\n📊 Collected ${attestations.length}/3 required attestations\n`);

    if (attestations.length < 3) {
        throw new Error('Not enough attestations');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Submit Attestations to Light Client
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━ STEP 2: Submit to Light Client ━━━━\n');

    const provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
    );

    const lightClientIdl = require('../target/idl/solana_light_client_x1.json');
    const lightClientProgram = new anchor.Program(lightClientIdl, lightClientProgramId, provider);

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v2'),
            userKeypair.publicKey.toBuffer(),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        lightClientProgramId
    );

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        lightClientProgramId
    );

    // Format attestations for submission
    const formattedAttestations = attestations.slice(0, 3).map((att: any) => ({
        validatorPubkey: new PublicKey(att.validator_pubkey),
        signature: att.signature,
        timestamp: new anchor.BN(att.timestamp || Date.now()),
    }));

    console.log(`📤 Submitting attestations to light client...`);

    const submitTx = await lightClientProgram.methods
        .submitBurnAttestation({
            burnNonce: new anchor.BN(BURN_NONCE),
            user: userKeypair.publicKey,
            amount: new anchor.BN(10000),
            validatorSetVersion: new anchor.BN(1),
            attestations: formattedAttestations,
        })
        .accounts({
            verifiedBurn: verifiedBurnPda,
            validatorSet: validatorSetPda,
            signer: userKeypair.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([userKeypair])
        .rpc();

    console.log(`✅ Attestations verified!`);
    console.log(`📝 Signature: ${submitTx}`);
    console.log(`📍 VerifiedBurn PDA: ${verifiedBurnPda.toBase58()}\n`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 3: Mint Tokens
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━ STEP 3: Mint XENCAT on X1 ━━━━\n');

    const mintIdl = require('../target/idl/xencat_mint_x1.json');
    const mintProgram = new anchor.Program(mintIdl, mintProgramId, provider);

    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        mintProgramId
    );

    const [xencatMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('xencat_mint')],
        mintProgramId
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        mintProgramId
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        xencatMintPda,
        userKeypair.publicKey
    );

    // Fetch validator set for fee distribution
    const validatorSetData: any = await lightClientProgram.account.x1ValidatorSet.fetch(validatorSetPda);

    console.log(`💸 Fee Distribution:`);
    const mintStateData = await mintProgram.account.mintState.fetch(mintStatePda) as any;
    const feePerValidator = mintStateData.feePerValidator.toNumber();
    const totalFee = feePerValidator * validatorSetData.validators.length;
    console.log(`   Fee per validator: ${feePerValidator} lamports (${feePerValidator / 1_000_000} XNT)`);
    console.log(`   Total validators: ${validatorSetData.validators.length}`);
    console.log(`   Total fee: ${totalFee} lamports (${totalFee / 1_000_000} XNT)\n`);

    // Prepare remaining accounts (validators receive fees)
    const remainingAccounts = validatorSetData.validators.map((validator: any) => ({
        pubkey: validator,
        isWritable: true,
        isSigner: false,
    }));

    console.log(`🪙  Minting tokens...`);

    const mintTx = await mintProgram.methods
        .mintFromBurn(new anchor.BN(BURN_NONCE))
        .accounts({
            mintState: mintStatePda,
            xencatMint: xencatMintPda,
            processedBurn: processedBurnPda,
            userTokenAccount: userTokenAccount,
            user: userKeypair.publicKey,
            validatorSet: validatorSetPda,
            verifiedBurn: verifiedBurnPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([userKeypair])
        .rpc();

    console.log(`✅ XENCAT minted!`);
    console.log(`📝 Signature: ${mintTx}`);
    console.log(`📍 ProcessedBurn PDA: ${processedBurnPda.toBase58()}\n`);

    console.log('━━━━ Fee Distribution Summary ━━━━\n');
    console.log(`✅ Distributed ${totalFee} lamports to ${validatorSetData.validators.length} validators`);
    console.log(`✅ Each validator received ${feePerValidator} lamports (${feePerValidator / 1_000_000} XNT)\n`);

    console.log('🎉 BRIDGE COMPLETE!\n');
}

main().catch(console.error);
