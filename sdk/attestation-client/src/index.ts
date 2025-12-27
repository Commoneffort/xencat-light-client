import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

export interface AttestationRequest {
    burn_nonce: number;
    user: string;
    expected_amount: number;
}

export interface Attestation {
    burn_nonce: number;
    user: string;
    amount: number;
    slot: number;
    validator_pubkey: string;
    signature: number[];
    timestamp: number;
}

export async function collectAttestations(
    x1Connection: Connection,
    lightClientProgramId: PublicKey,
    request: AttestationRequest
): Promise<Attestation[]> {
    console.log('\n🔍 Collecting attestations from X1 validators...\n');

    // Load IDL from local file
    const idlPath = path.join(__dirname, '../../../target/idl/solana_light_client_x1.json');
    const idlData = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const program = new anchor.Program(
        idlData as anchor.Idl,
        lightClientProgramId,
        new anchor.AnchorProvider(x1Connection, {} as any, {})
    );

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set')],
        lightClientProgramId
    );

    const validatorSet: any = await program.account.x1ValidatorSet.fetch(validatorSetPda);

    console.log(`📊 Found ${validatorSet.validators.length} validators`);
    console.log(`   Threshold: ${validatorSet.threshold}\n`);

    // Request attestations from all validators
    const attestationPromises = validatorSet.validators.map(async (validator: any) => {
        if (!validator.active) {
            console.log(`⏭️  Skipping inactive validator: ${validator.name}`);
            return null;
        }

        try {
            console.log(`📡 Requesting attestation from: ${validator.name}`);
            console.log(`   API: ${validator.attestationApi}`);

            const response = await fetch(validator.attestationApi + '/attest-burn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            if (!response.ok) {
                const error = await response.text();
                console.log(`❌ ${validator.name} failed: ${error}`);
                return null;
            }

            const attestation = await response.json();
            console.log(`✅ ${validator.name} signed attestation`);

            return attestation;

        } catch (error: any) {
            console.log(`❌ Failed to reach ${validator.name}: ${error.message}`);
            return null;
        }
    });

    const results = await Promise.all(attestationPromises);
    const validAttestations = results.filter(a => a !== null) as Attestation[];

    console.log(`\n📊 Attestation Summary:`);
    console.log(`   Received: ${validAttestations.length}`);
    console.log(`   Required: ${validatorSet.threshold}`);

    if (validAttestations.length < validatorSet.threshold) {
        throw new Error(
            `Not enough attestations: ${validAttestations.length} < ${validatorSet.threshold}`
        );
    }

    console.log(`✅ Threshold met!\n`);

    return validAttestations;
}
