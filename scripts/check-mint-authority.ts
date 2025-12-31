import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');

async function main() {
    const connection = new Connection(X1_RPC);
    const mintInfo = await getMint(connection, XENCAT_MINT);

    console.log('\n🔍 XENCAT Mint Info (X1)');
    console.log('━'.repeat(60));
    console.log('Mint Address:', XENCAT_MINT.toBase58());
    console.log('Mint Authority:', mintInfo.mintAuthority?.toBase58() || 'None (immutable)');
    console.log('Freeze Authority:', mintInfo.freezeAuthority?.toBase58() || 'None');
    console.log('Decimals:', mintInfo.decimals);
    console.log('Supply:', (Number(mintInfo.supply) / 10**mintInfo.decimals).toFixed(2), 'XENCAT');
    console.log('━'.repeat(60));

    if (mintInfo.mintAuthority) {
        console.log('\n📝 To set metadata, you need to use this wallet:');
        console.log('   ', mintInfo.mintAuthority.toBase58());
    } else {
        console.log('\n⚠️  Warning: Mint has no authority (immutable)');
        console.log('   Metadata cannot be set by mint authority method.');
        console.log('   You may need to use update authority instead.');
    }
}

main().catch(console.error);
