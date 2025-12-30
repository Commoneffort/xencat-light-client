/**
 * Set Token Metadata for XENCAT on X1
 *
 * This script:
 * 1. Uploads logo to Irys (decentralized storage)
 * 2. Creates metadata JSON
 * 3. Uploads metadata JSON
 * 4. Creates on-chain metadata account
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
    generateSigner,
} from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XENCAT_MINT = 'DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb';
const LOGO_PATH = '/home/xen_cat/xencat.jpg';

async function main() {
    console.log('🎨 Setting XENCAT Token Metadata on X1\n');
    console.log('━'.repeat(60));

    // Initialize UMI with X1 RPC
    const umi = createUmi(X1_RPC)
        .use(mplTokenMetadata())
        .use(irysUploader());

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
    console.log();

    // Step 1: Upload logo image
    console.log('📤 Step 1: Uploading logo to Irys...');
    const imageBuffer = fs.readFileSync(LOGO_PATH);
    const imageFile = {
        buffer: imageBuffer,
        fileName: 'xencat.jpg',
        displayName: 'XENCAT Logo',
        uniqueName: 'xencat-logo',
        contentType: 'image/jpeg',
        extension: 'jpg',
        tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
    };

    const [imageUri] = await umi.uploader.upload([imageFile]);
    console.log('✅ Logo uploaded:', imageUri);
    console.log();

    // Step 2: Create and upload metadata JSON
    console.log('📤 Step 2: Creating metadata JSON...');
    const metadata = {
        name: 'XENCAT',
        symbol: 'XENCAT',
        description: 'XENCAT - The first trustless bridge token between Solana and X1',
        image: imageUri,
        attributes: [
            { trait_type: 'Network', value: 'X1' },
            { trait_type: 'Bridge', value: 'Trustless Light Client' },
            { trait_type: 'Type', value: 'SPL Token' },
        ],
        properties: {
            category: 'token',
            files: [
                {
                    uri: imageUri,
                    type: 'image/jpeg',
                },
            ],
        },
    };

    console.log('Metadata:', JSON.stringify(metadata, null, 2));
    console.log();

    console.log('📤 Step 3: Uploading metadata JSON to Irys...');
    const metadataUri = await umi.uploader.uploadJson(metadata);
    console.log('✅ Metadata uploaded:', metadataUri);
    console.log();

    // Step 3: Create on-chain metadata account
    console.log('📝 Step 4: Creating on-chain metadata account...');

    const mint = publicKey(XENCAT_MINT);

    try {
        await createMetadataAccountV3(umi, {
            mint,
            mintAuthority: signer,
            payer: signer,
            updateAuthority: signer.publicKey,
            data: {
                name: 'XENCAT',
                symbol: 'XENCAT',
                uri: metadataUri,
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null,
            },
            isMutable: true,
            collectionDetails: null,
        }).sendAndConfirm(umi);

        console.log('✅ Metadata account created!');
    } catch (error: any) {
        console.error('❌ Error creating metadata:', error.message);
        if (error.message.includes('already in use')) {
            console.log('\n⚠️  Metadata account already exists. Use update instead of create.');
        }
        throw error;
    }

    console.log();
    console.log('━'.repeat(60));
    console.log('🎉 XENCAT Token Metadata Set Successfully!');
    console.log('━'.repeat(60));
    console.log(`📷 Image URI: ${imageUri}`);
    console.log(`📄 Metadata URI: ${metadataUri}`);
    console.log(`🪙  Token: ${XENCAT_MINT}`);
}

main().catch(console.error);
