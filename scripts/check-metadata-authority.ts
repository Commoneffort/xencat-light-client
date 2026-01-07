import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import {
    findMetadataPda,
    mplTokenMetadata,
    fetchMetadata
} from '@metaplex-foundation/mpl-token-metadata';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = 'DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb';

async function main() {
    const umi = createUmi(X1_RPC).use(mplTokenMetadata());
    const mint = publicKey(XENCAT_MINT);

    const metadataPda = findMetadataPda(umi, { mint });

    console.log('\n🔍 XENCAT Metadata Authority Check');
    console.log('━'.repeat(60));

    try {
        const metadata = await fetchMetadata(umi, metadataPda);

        console.log('Metadata PDA:', metadataPda[0]);
        console.log('Update Authority:', metadata.updateAuthority);
        console.log('Is Mutable:', metadata.isMutable);
        console.log();
        console.log('Token Info:');
        console.log('  Name:', metadata.name);
        console.log('  Symbol:', metadata.symbol);
        console.log('  URI:', metadata.uri);
        console.log('━'.repeat(60));

        const MINT_STATE_PDA = 'CpEv4bdRv8SLT3N8KpaPVcdqdCM9nzahjMYXgDsxdQ1W';

        if (metadata.updateAuthority.toString() === MINT_STATE_PDA) {
            console.log('\n⚠️  Update Authority is MintState PDA');
            console.log('   This means metadata can ONLY be updated via program instruction');
            console.log('   If program becomes immutable WITHOUT an update_metadata instruction,');
            console.log('   metadata will be frozen forever!');
        } else {
            console.log('\n✅ Update Authority is a regular wallet');
            console.log('   Metadata can be updated independently of program immutability');
        }

    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

main().catch(console.error);
