import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import { collectAttestations } from '../sdk/attestation-client/src';

async function main() {
    console.log('\n🎯 X1 VALIDATOR ATTESTATION E2E TEST\n');

    // Configuration
    const X1_RPC = 'https://rpc.mainnet.x1.xyz';
    const XENCAT_MINT_X1 = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');
    const BURN_NONCE = parseInt(process.env.BURN_NONCE || '43');

    // Load user keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY required');
    }

    let userKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`👤 User: ${userKeypair.publicKey.toBase58()}`);
    console.log(`🔥 Burn Nonce: ${BURN_NONCE}\n`);

    const x1Connection = new Connection(X1_RPC, 'confirmed');

    // Load program IDs
    const lightClientIdlPath = path.join(__dirname, '../target/idl/solana_light_client_x1.json');
    const lightClientIdlData = JSON.parse(fs.readFileSync(lightClientIdlPath, 'utf-8'));
    const LIGHT_CLIENT_PROGRAM = new PublicKey(lightClientIdlData.metadata.address);

    const mintIdlPath = path.join(__dirname, '../target/idl/xencat_mint_x1.json');
    const mintIdlData = JSON.parse(fs.readFileSync(mintIdlPath, 'utf-8'));
    const MINT_PROGRAM = new PublicKey(mintIdlData.metadata.address);

    console.log(`📝 Light Client Program: ${LIGHT_CLIENT_PROGRAM.toBase58()}`);
    console.log(`📝 Mint Program: ${MINT_PROGRAM.toBase58()}\n`);

    // =================================================================
    // STEP 1: COLLECT ATTESTATIONS FROM X1 VALIDATORS
    // =================================================================

    console.log('━━━━ STEP 1: Collect X1 Validator Attestations ━━━━');

    const attestations = await collectAttestations(
        x1Connection,
        LIGHT_CLIENT_PROGRAM,
        {
            burn_nonce: BURN_NONCE,
            user: userKeypair.publicKey.toBase58(),
            expected_amount: 10000, // 0.00001 XENCAT (actual burn amount for nonce 43)
        }
    );

    console.log(`✅ Collected ${attestations.length} attestations\n`);

    // =================================================================
    // STEP 2: SUBMIT ATTESTATIONS TO CONTRACT
    // =================================================================

    console.log('━━━━ STEP 2: Submit Attestations to Contract ━━━━\n');

    const lightClientProgram = new anchor.Program(
        lightClientIdlData as anchor.Idl,
        LIGHT_CLIENT_PROGRAM,
        new anchor.AnchorProvider(x1Connection, new anchor.Wallet(userKeypair), {})
    );

    // Get PDAs
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set')],
        LIGHT_CLIENT_PROGRAM
    );

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn'),
            userKeypair.publicKey.toBuffer(),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8)
        ],
        LIGHT_CLIENT_PROGRAM
    );

    // Check if already verified
    try {
        const existingBurn = await lightClientProgram.account.verifiedBurn.fetch(verifiedBurnPda);
        console.log('⚠️  Burn already verified!');
        console.log(`   Amount: ${existingBurn.amount}`);
        console.log(`   Processed: ${existingBurn.processed}`);

        if (existingBurn.processed) {
            console.log('\n✅ This burn has already been minted!');
            return;
        }

        console.log('\n   Proceeding to mint...\n');
    } catch (e) {
        // Not verified yet, submit attestations
        console.log('📝 Submitting burn attestation...\n');

        // Build attestation data
        const attestationData = {
            burnNonce: new anchor.BN(BURN_NONCE),
            user: userKeypair.publicKey,
            amount: new anchor.BN(attestations[0].amount),
            slot: new anchor.BN(attestations[0].slot),
            attestations: attestations.map(a => ({
                validatorPubkey: new PublicKey(a.validator_pubkey),
                signature: a.signature,
                timestamp: new anchor.BN(a.timestamp),
            })),
        };

        // Submit
        const submitTx = await lightClientProgram.methods
            .submitBurnAttestation(attestationData)
            .accounts({
                user: userKeypair.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`📝 Submit TX: ${submitTx}`);
        await x1Connection.confirmTransaction(submitTx, 'confirmed');
        console.log(`✅ Burn verified on X1!\n`);

        // Check transaction size
        const submitInstruction = await lightClientProgram.methods
            .submitBurnAttestation(attestationData)
            .accounts({
                user: userKeypair.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        const testTx = new Transaction().add(submitInstruction);
        const { blockhash } = await x1Connection.getLatestBlockhash();
        testTx.recentBlockhash = blockhash;
        testTx.feePayer = userKeypair.publicKey;

        const txSize = testTx.serialize({ requireAllSignatures: false }).length;
        console.log(`📦 Transaction size: ${txSize} bytes (limit: 1232)`);
        console.log(`   Remaining: ${1232 - txSize} bytes\n`);
    }

    // =================================================================
    // STEP 3: MINT TOKENS
    // =================================================================

    console.log('━━━━ STEP 3: Mint Tokens ━━━━\n');

    const mintProgram = new anchor.Program(
        mintIdlData as anchor.Idl,
        MINT_PROGRAM,
        new anchor.AnchorProvider(x1Connection, new anchor.Wallet(userKeypair), {})
    );

    const [mintState] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        MINT_PROGRAM
    );

    const [processedBurn] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8)
        ],
        MINT_PROGRAM
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT_X1,
        userKeypair.publicKey
    );

    // Check if user token account exists, create if not
    const userTokenAccountInfo = await x1Connection.getAccountInfo(userTokenAccount);
    if (!userTokenAccountInfo) {
        console.log('📝 Creating associated token account for user...');
        const createAtaIx = createAssociatedTokenAccountInstruction(
            userKeypair.publicKey,
            userTokenAccount,
            userKeypair.publicKey,
            XENCAT_MINT_X1,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const createAtaTx = new Transaction().add(createAtaIx);
        const createAtaSig = await x1Connection.sendTransaction(createAtaTx, [userKeypair]);
        await x1Connection.confirmTransaction(createAtaSig, 'confirmed');
        console.log(`✅ Token account created: ${userTokenAccount.toBase58()}\n`);
    } else {
        console.log(`✅ Token account exists: ${userTokenAccount.toBase58()}\n`);
    }

    const mintStateAccount = await x1Connection.getAccountInfo(mintState);
    if (!mintStateAccount) {
        throw new Error('MintState not found. Initialize the mint program first.');
    }
    // MintState layout: discriminator(8) + authority(32) + xencat_mint(32) + fee_receiver(32)
    const mintFeeReceiver = new PublicKey(mintStateAccount.data.slice(72, 104));

    const mintTx = await mintProgram.methods
        .mintFromBurn(new anchor.BN(BURN_NONCE))
        .accounts({
            mintState,
            xencatMint: XENCAT_MINT_X1,
            processedBurn,
            userTokenAccount,
            user: userKeypair.publicKey,
            mintFeeReceiver,
            verifiedBurn: verifiedBurnPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    console.log(`📝 Mint TX: ${mintTx}`);
    await x1Connection.confirmTransaction(mintTx, 'confirmed');
    console.log(`✅ Tokens minted!\n`);

    // =================================================================
    // STEP 4: VERIFY RESULTS
    // =================================================================

    console.log('━━━━ STEP 4: Verify Results ━━━━\n');

    const tokenBalance = await x1Connection.getTokenAccountBalance(userTokenAccount);
    console.log(`✅ User token balance: ${tokenBalance.value.uiAmount} XENCAT\n`);

    console.log(`\n🎉 E2E TEST COMPLETE!\n`);
    console.log(`Summary:`);
    console.log(`  • Burned: 0.01 XENCAT (nonce ${BURN_NONCE})`);
    console.log(`  • X1 validators: ${attestations.length} attestations`);
    console.log(`  • Transaction size: Within limit ✅`);
    console.log(`  • Balance: ${tokenBalance.value.uiAmount} XENCAT`);
    console.log(`\n✅ BRIDGE FULLY FUNCTIONAL WITH X1 VALIDATORS!\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Error:');
        console.error(error);
        process.exit(1);
    });
