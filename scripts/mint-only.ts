import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';

const BURN_NONCE = parseInt(process.env.BURN_NONCE || '38');

async function main() {
    console.log('\n🪙 MINT ONLY - NONCE', BURN_NONCE, '\n');

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

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        lightClientProgramId
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        xencatMintPda,
        userKeypair.publicKey
    );

    // Check if ATA exists, create if not
    const ataInfo = await x1Connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
        console.log('📝 Creating associated token account...');
        const createAtaIx = createAssociatedTokenAccountInstruction(
            userKeypair.publicKey,
            userTokenAccount,
            userKeypair.publicKey,
            xencatMintPda
        );

        const tx = new anchor.web3.Transaction().add(createAtaIx);
        const sig = await x1Connection.sendTransaction(tx, [userKeypair]);
        await x1Connection.confirmTransaction(sig);
        console.log('✅ ATA created\n');
    }

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

    console.log(`🪙  Minting tokens for nonce ${BURN_NONCE}...`);

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
    console.log(`🔗 Explorer: https://explorer.x1.xyz/tx/${mintTx}`);
    console.log(`📍 ProcessedBurn PDA: ${processedBurnPda.toBase58()}\n`);

    console.log('━━━━ Fee Distribution Summary ━━━━\n');
    console.log(`✅ Distributed ${totalFee} lamports to ${validatorSetData.validators.length} validators`);
    console.log(`✅ Each validator received ${feePerValidator} lamports (${feePerValidator / 1_000_000} XNT)\n`);

    console.log('🎉 MINT COMPLETE!\n');
}

main().catch(console.error);
