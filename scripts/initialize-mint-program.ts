import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

async function main() {
    console.log('\n🚀 Initialize Mint Program\n');

    // Load authority keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY!;
    let authorityKeypair: Keypair;
    try {
        authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKeyEnv)));
    } catch {
        authorityKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`🔑 Authority: ${authorityKeypair.publicKey.toBase58()}\n`);

    const x1Connection = new Connection('https://rpc.mainnet.x1.xyz', 'confirmed');
    const mintProgramId = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');

    const provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(authorityKeypair),
        { commitment: 'confirmed' }
    );

    const mintIdl = require('../target/idl/xencat_mint_x1.json');
    const mintProgram = new anchor.Program(mintIdl, mintProgramId, provider);

    // Derive PDAs
    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        mintProgramId
    );

    const [xencatMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('xencat_mint')],
        mintProgramId
    );

    console.log(`📍 MintState PDA: ${mintStatePda.toBase58()}`);
    console.log(`📍 XENCAT Mint PDA: ${xencatMintPda.toBase58()}\n`);

    // Check if already initialized
    try {
        const mintStateData: any = await mintProgram.account.mintState.fetch(mintStatePda);
        console.log('⚠️  Mint program already initialized!');
        console.log(`   Authority: ${mintStateData.authority.toBase58()}`);
        console.log(`   Fee per validator: ${mintStateData.feePerValidator.toNumber()} lamports`);
        console.log(`   Processed burns: ${mintStateData.processedBurnsCount.toNumber()}`);
        console.log(`   Total minted: ${mintStateData.totalMinted.toNumber()}\n`);
        return;
    } catch (e) {
        console.log('✅ MintState not initialized, proceeding with initialization...\n');
    }

    // Initialize
    console.log('🔄 Initializing mint program...');

    const lightClientProgramId = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');

    const initTx = await mintProgram.methods
        .initialize(lightClientProgramId)
        .accounts({
            mintState: mintStatePda,
            xencatMint: xencatMintPda,
            authority: authorityKeypair.publicKey,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([authorityKeypair])
        .rpc();

    console.log('✅ Mint program initialized!');
    console.log(`📝 Signature: ${initTx}`);
    console.log(`🔗 Explorer: https://explorer.x1.xyz/tx/${initTx}\n`);

    // Fetch and display state
    const mintStateData: any = await mintProgram.account.mintState.fetch(mintStatePda);
    console.log('━━━━ Mint Program State ━━━━\n');
    console.log(`Authority: ${mintStateData.authority.toBase58()}`);
    console.log(`XENCAT Mint: ${mintStateData.xencatMint.toBase58()}`);
    console.log(`Fee per validator: ${mintStateData.feePerValidator.toNumber()} lamports (0.01 XNT)`);
    console.log(`Processed burns: ${mintStateData.processedBurnsCount.toNumber()}`);
    console.log(`Total minted: ${mintStateData.totalMinted.toNumber()}\n`);

    console.log('🎉 INITIALIZATION COMPLETE!\n');
}

main().catch(console.error);
