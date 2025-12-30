/**
 * Set Token Metadata for XENCAT on X1 (Simple Version)
 *
 * Uses GitHub-hosted metadata (no upload costs)
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
    createMetadataAccountV3,
    mplTokenMetadata
} from '@metaplex-foundation/mpl-token-metadata';
import {
    createSignerFromKeypair,
    signerIdentity,
    publicKey,
} from '@metaplex-foundation/umi';
import * as dotenv from 'dotenv';

dotenv.config();

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = 'DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb';
const METADATA_URI = 'https://raw.githubusercontent.com/Commoneffort/xencat-light-client/main/metadata/xencat-metadata.json';

async function main() {
    console.log('🎨 Setting XENCAT Token Metadata on X1\n');
    console.log('━'.repeat(60));

    // Initialize UMI with X1 RPC
    const umi = createUmi(X1_RPC).use(mplTokenMetadata());

    // Load authority keypair from .env
    const privateKey = process.env.USER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('USER_PRIVATE_KEY not found in .env');
    }

    let secretKey: Uint8Array;
    try {
        secretKey = new Uint8Array(JSON.parse(privateKey));
    } catch {
        const bs58 = require('bs58');
        secretKey = bs58.decode(privateKey);
    }

    const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    console.log('👤 Authority:', signer.publicKey);
    console.log('🪙  Token Mint:', XENCAT_MINT);
    console.log('📄 Metadata URI:', METADATA_URI);
    console.log();

    // Create on-chain metadata account
    console.log('📝 Creating on-chain metadata account...');

    const mint = publicKey(XENCAT_MINT);

    try {
        const result = await createMetadataAccountV3(umi, {
            mint,
            mintAuthority: signer,
            payer: signer,
            updateAuthority: signer.publicKey,
            data: {
                name: 'XENCAT',
                symbol: 'XENCAT',
                uri: METADATA_URI,
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null,
            },
            isMutable: true,
            collectionDetails: null,
        }).sendAndConfirm(umi);

        console.log('✅ Metadata account created!');
        console.log('📝 Signature:', result.signature);
    } catch (error: any) {
        console.error('❌ Error creating metadata:', error.message);
        if (error.message.includes('already in use') || error.message.includes('already exists')) {
            console.log('\n⚠️  Metadata account already exists.');
            console.log('    To update existing metadata, you need to use updateMetadataAccountV2 instead.');
        } else if (error.logs) {
            console.log('\n📋 Transaction logs:');
            error.logs.forEach((log: string) => console.log('   ', log));
        }
        throw error;
    }

    console.log();
    console.log('━'.repeat(60));
    console.log('🎉 XENCAT Token Metadata Set Successfully!');
    console.log('━'.repeat(60));
    console.log(`📄 Metadata URI: ${METADATA_URI}`);
    console.log(`🪙  Token: ${XENCAT_MINT}`);
    console.log();
    console.log('You can now view the token with metadata in X1 wallets!');
}

main().catch(console.error);
