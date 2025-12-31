import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { XencatMintX1 } from '../target/types/xencat_mint_x1';
import idl from '../target/idl/xencat_mint_x1.json';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const MINT_PROGRAM_ID = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');

async function main() {
    const connection = new Connection(X1_RPC);
    const provider = new AnchorProvider(connection, {} as any, {});
    const program = new Program(idl as any, MINT_PROGRAM_ID, provider) as Program<XencatMintX1>;

    // Derive MintState V2 PDA
    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        MINT_PROGRAM_ID
    );

    const mintState = await program.account.mintState.fetch(mintStatePda);

    console.log('\n📋 XENCAT Mint State (V2)');
    console.log('━'.repeat(60));
    console.log('MintState PDA:', mintStatePda.toBase58());
    console.log('Authority:', mintState.authority.toBase58());
    console.log('XENCAT Mint:', mintState.xencatMint.toBase58());
    console.log('Fee per Validator:', mintState.feePerValidator.toString(), 'lamports');
    console.log('Validator Set Version:', mintState.validatorSetVersion.toString());
    console.log('Processed Burns:', mintState.processedBurnsCount.toString());
    console.log('Total Minted:', (Number(mintState.totalMinted) / 1_000_000).toFixed(2), 'XENCAT');
    console.log('━'.repeat(60));
}

main().catch(console.error);
