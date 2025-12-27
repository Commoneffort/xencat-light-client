import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

async function main() {
    console.log('\n🔄 TRANSFER MINT AUTHORITY (V1 → V2)\n');

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
    const [legacyMintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state')],
        mintProgramId
    );

    const [newMintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        mintProgramId
    );

    const [xencatMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('xencat_mint')],
        mintProgramId
    );

    console.log(`📍 Legacy MintState (V1): ${legacyMintStatePda.toBase58()}`);
    console.log(`📍 New MintState (V2): ${newMintStatePda.toBase58()}`);
    console.log(`📍 XENCAT Mint: ${xencatMintPda.toBase58()}\n`);

    console.log('🔄 Executing authority transfer...\n');

    const transferTx = await mintProgram.methods
        .transferMintAuthority()
        .accounts({
            legacyMintState: legacyMintStatePda,
            newMintState: newMintStatePda,
            xencatMint: xencatMintPda,
            authority: authorityKeypair.publicKey,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([authorityKeypair])
        .rpc();

    console.log('✅ Authority transferred successfully!');
    console.log(`📝 Signature: ${transferTx}`);
    console.log(`🔗 Explorer: https://explorer.x1.xyz/tx/${transferTx}\n`);

    console.log('━━━━ Migration Complete ━━━━\n');
    console.log(`✅ Old mint_state permanently disabled`);
    console.log(`✅ New mint_state_v2 is now the mint authority`);
    console.log(`✅ Fee distribution system active\n`);
}

main().catch(console.error);
