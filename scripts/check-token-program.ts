import { Connection, PublicKey } from '@solana/web3.js';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');

const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

async function main() {
    const connection = new Connection(X1_RPC);
    const accountInfo = await connection.getAccountInfo(XENCAT_MINT);

    if (!accountInfo) {
        console.log('❌ Mint account not found');
        return;
    }

    const owner = accountInfo.owner.toBase58();

    console.log('\n🔍 XENCAT Token Program Check');
    console.log('━'.repeat(60));
    console.log('Mint:', XENCAT_MINT.toBase58());
    console.log('Owner Program:', owner);
    console.log();

    if (owner === SPL_TOKEN) {
        console.log('✅ Token Type: SPL Token (Original)');
        console.log('   Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        console.log('   This is the standard SPL Token program');
    } else if (owner === TOKEN_2022) {
        console.log('✅ Token Type: Token-2022 (Extensions)');
        console.log('   Program: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
        console.log('   This is the new Token-2022 program with extensions');
    } else {
        console.log('⚠️  Unknown token program:', owner);
    }
    console.log('━'.repeat(60));
}

main().catch(console.error);
