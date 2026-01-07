/**
 * Create DGN Token Metadata via Program Instruction
 *
 * Uses the create_metadata instruction in dgn-mint-x1 program
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { DgnMintX1 } from '../target/types/dgn_mint_x1';
import idl from '../target/idl/dgn_mint_x1.json';
import * as dotenv from 'dotenv';

dotenv.config();

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const MINT_PROGRAM_ID = new PublicKey('4YPipW8txxY3N7gHdj4NLhu8YxybHgarx5dJQCdCnQHs');
const DGN_MINT = new PublicKey('84PxDRsNyiRJU4gfFiD7RqvZzqh5FdqXjDdtFV3N3oxc');
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Metadata configuration
const METADATA_NAME = 'Degen';
const METADATA_SYMBOL = 'DGN';
const METADATA_URI = 'https://ipfs.io/ipfs/bafkreig7xnvrx3dcx2xgqsb5422gcsbgb6srwxoqeawevynvnelibmwtgq';

async function main() {
    console.log('🎨 Creating DGN Token Metadata via Program\n');
    console.log('━'.repeat(60));

    // Load authority keypair
    const privateKey = process.env.USER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('USER_PRIVATE_KEY not found in .env');
    }

    let authorityKeypair: Keypair;
    try {
        const secretKey = new Uint8Array(JSON.parse(privateKey));
        authorityKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
        const bs58 = require('bs58');
        authorityKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    }

    // Setup connection and program
    const connection = new Connection(X1_RPC, 'confirmed');
    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl as any, MINT_PROGRAM_ID, provider) as Program<DgnMintX1>;

    // Derive PDAs
    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('dgn_mint_state')],
        MINT_PROGRAM_ID
    );

    const [metadataPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('metadata'),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            DGN_MINT.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
    );

    console.log('Authority:', authorityKeypair.publicKey.toBase58());
    console.log('MintState PDA:', mintStatePda.toBase58());
    console.log('DGN Mint:', DGN_MINT.toBase58());
    console.log('Metadata PDA:', metadataPda.toBase58());
    console.log();
    console.log('Metadata Configuration:');
    console.log('  Name:', METADATA_NAME);
    console.log('  Symbol:', METADATA_SYMBOL);
    console.log('  URI:', METADATA_URI);
    console.log();

    // Create metadata
    console.log('📝 Creating metadata account...');

    try {
        const tx = await program.methods
            .createMetadata(METADATA_NAME, METADATA_SYMBOL, METADATA_URI)
            .accounts({
                mintState: mintStatePda,
                dgnMint: DGN_MINT,
                metadata: metadataPda,
                authority: authorityKeypair.publicKey,
                payer: authorityKeypair.publicKey,
                tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        console.log('✅ Metadata created successfully!');
        console.log('📝 Transaction:', tx);
        console.log('🔗 Explorer: https://explorer.x1.xyz/tx/' + tx);
        console.log();
        console.log('━'.repeat(60));
        console.log('🎉 Token Metadata Set!');
        console.log('━'.repeat(60));
        console.log('Metadata PDA:', metadataPda.toBase58());
        console.log('Name:', METADATA_NAME);
        console.log('Symbol:', METADATA_SYMBOL);
        console.log('URI:', METADATA_URI);
        console.log();
        console.log('X1 wallets and explorers will now display:');
        console.log('  • Token symbol: DGN');
        console.log('  • Token logo from IPFS');
        console.log('  • Token description and attributes');

    } catch (error: any) {
        console.error('❌ Error creating metadata:', error.message);
        if (error.logs) {
            console.log('\n📋 Transaction logs:');
            error.logs.forEach((log: string) => console.log('   ', log));
        }
        throw error;
    }
}

main().catch(console.error);
