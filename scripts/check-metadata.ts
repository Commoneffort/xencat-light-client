import { Connection, PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import { findMetadataPda, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = 'DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb';

async function main() {
    const umi = createUmi(X1_RPC).use(mplTokenMetadata());
    const mint = publicKey(XENCAT_MINT);

    // Find metadata PDA
    const metadataPda = findMetadataPda(umi, { mint });

    console.log('\n🔍 Checking XENCAT Metadata Account');
    console.log('━'.repeat(60));
    console.log('Mint:', XENCAT_MINT);
    console.log('Expected Metadata PDA:', metadataPda[0]);
    console.log('━'.repeat(60));

    try {
        const account = await umi.rpc.getAccount(metadataPda[0]);

        if (account.exists) {
            console.log('\n✅ Metadata account exists!');
            console.log('   Owner:', account.owner);
            console.log('   Size:', account.lamports, 'lamports');
            console.log('\n⚠️  To update existing metadata, use updateMetadataAccountV2 instead of create');
        } else {
            console.log('\n❌ Metadata account does not exist');
            console.log('   You can create it as update authority (not mint authority)');
        }
    } catch (error: any) {
        console.log('\n❌ Metadata account does not exist');
        console.log('   You can create it as update authority');
    }
}

main().catch(console.error);
