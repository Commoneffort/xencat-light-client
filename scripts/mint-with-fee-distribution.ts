import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';

const BURN_NONCE = parseInt(process.env.BURN_NONCE || '38');

async function main() {
    console.log('\n🪙 MINT WITH FEE DISTRIBUTION - NONCE', BURN_NONCE, '\n');

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
    const xencatMintPda = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');

    const provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
    );

    const lightClientIdl = require('../target/idl/solana_light_client_x1.json');
    const lightClientProgram = new anchor.Program(lightClientIdl, lightClientProgramId, provider);

    const mintIdl = require('../target/idl/xencat_mint_x1.json');
    const mintProgram = new anchor.Program(mintIdl, mintProgramId, provider);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Fetch Validator Set
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━ STEP 1: Fetch Validator Set ━━━━\n');

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        lightClientProgramId
    );

    const validatorSet: any = await lightClientProgram.account.x1ValidatorSet.fetch(validatorSetPda);

    console.log(`📊 Validator Set (Version ${validatorSet.version}):`);
    console.log(`   Validators: ${validatorSet.validators.length}`);
    console.log(`   Threshold: ${validatorSet.threshold}`);

    validatorSet.validators.forEach((v: PublicKey, i: number) => {
        console.log(`   ${i + 1}. ${v.toBase58()}`);
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Prepare Accounts
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n━━━━ STEP 2: Prepare Accounts ━━━━\n');

    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        mintProgramId
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        mintProgramId
    );

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v2'),
            userKeypair.publicKey.toBuffer(),
            new anchor.BN(BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        lightClientProgramId
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        xencatMintPda,
        userKeypair.publicKey
    );

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 3: Prepare Remaining Accounts (Validators)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━ STEP 3: Prepare Fee Distribution ━━━━\n');

    // Each validator will receive fees directly to their pubkey
    const remainingAccounts = validatorSet.validators.map((validator: PublicKey) => ({
        pubkey: validator,
        isWritable: true,  // Must be writable to receive fees
        isSigner: false,
    }));

    console.log(`💸 Fee Distribution:`);

    const mintStateData: any = await mintProgram.account.mintState.fetch(mintStatePda);
    const feePerValidator = mintStateData.feePerValidator.toNumber();
    const totalFee = feePerValidator * validatorSet.validators.length;

    console.log(`   Fee per validator: ${feePerValidator} lamports (${feePerValidator / 1_000_000} XNT)`);
    console.log(`   Total validators: ${validatorSet.validators.length}`);
    console.log(`   Total fee: ${totalFee} lamports (${totalFee / 1_000_000} XNT)\n`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 4: Mint Tokens
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━ STEP 4: Mint XENCAT Tokens ━━━━\n');

    console.log(`🪙  Minting tokens for nonce ${BURN_NONCE}...`);

    const mintTx = await mintProgram.methods
        .mintFromBurn(new anchor.BN(BURN_NONCE))
        .accounts({
            mintState: mintStatePda,
            xencatMint: xencatMintPda,
            processedBurn: processedBurnPda,
            userTokenAccount: userTokenAccount,
            user: userKeypair.publicKey,
            validatorSet: validatorSetPda,  // NEW: Validator set for fee distribution
            verifiedBurn: verifiedBurnPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)  // NEW: Validator accounts for fees
        .signers([userKeypair])
        .rpc();

    console.log(`✅ XENCAT minted!`);
    console.log(`📝 Signature: ${mintTx}`);
    console.log(`🔗 Explorer: https://explorer.x1.xyz/tx/${mintTx}`);
    console.log(`📍 ProcessedBurn PDA: ${processedBurnPda.toBase58()}\n`);

    console.log('━━━━ Fee Distribution Summary ━━━━\n');
    console.log(`✅ Distributed ${totalFee} lamports to ${validatorSet.validators.length} validators`);
    console.log(`✅ Each validator received ${feePerValidator} lamports directly\n`);

    console.log('🎉 MINT COMPLETE!\n');
}

main().catch(console.error);
