"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var anchor = require("@coral-xyz/anchor");
var anchor_1 = require("@coral-xyz/anchor");
var web3_js_1 = require("@solana/web3.js");
var fs_1 = require("fs");
var node_fetch_1 = require("node-fetch");
require("dotenv/config");
var X1_RPC = 'https://rpc.mainnet.x1.xyz';
var BURN_AMOUNT = 10000;
var VALIDATORS = [
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: new web3_js_1.PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: new web3_js_1.PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: new web3_js_1.PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var userKeypair, userPrivateKey, privateKeyArray, bs58, keypairPath, keypairData, x1Connection, x1Provider, lightClientProgramId, lightClientIdl, lightClientProgram, validatorSetPda, validatorSet, currentVersion, BURN_NONCE_7_1, attestation, response, error_1, verifiedBurnPda, duplicatedAttestations, attestationData, tx, error_2, BURN_NONCE_8_1, fakeValidator, verifiedBurnPda, fakeAttestations, attestationData, tx, error_3, BURN_NONCE_8_2, validAttestations, i, response, attestation, error_4, fakeValidator, verifiedBurnPda, mixedAttestations, attestationData, tx, error_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 VALIDATOR INTEGRITY TESTS');
                    console.log('━'.repeat(60));
                    userPrivateKey = process.env.USER_PRIVATE_KEY;
                    if (userPrivateKey) {
                        try {
                            privateKeyArray = JSON.parse(userPrivateKey);
                            userKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
                        }
                        catch (_b) {
                            bs58 = require('bs58');
                            userKeypair = web3_js_1.Keypair.fromSecretKey(bs58.decode(userPrivateKey));
                        }
                    }
                    else {
                        keypairPath = process.env.HOME + '/.config/solana/identity.json';
                        keypairData = JSON.parse(fs_1["default"].readFileSync(keypairPath, 'utf-8'));
                        userKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(keypairData));
                    }
                    console.log('👤 User:', userKeypair.publicKey.toBase58());
                    x1Connection = new web3_js_1.Connection(X1_RPC, 'confirmed');
                    x1Provider = new anchor.AnchorProvider(x1Connection, new anchor.Wallet(userKeypair), { commitment: 'confirmed' });
                    lightClientProgramId = new web3_js_1.PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
                    lightClientIdl = JSON.parse(fs_1["default"].readFileSync('./target/idl/solana_light_client_x1.json', 'utf-8'));
                    lightClientProgram = new anchor_1.Program(lightClientIdl, lightClientProgramId, x1Provider);
                    validatorSetPda = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('x1_validator_set_v2')], lightClientProgram.programId)[0];
                    return [4 /*yield*/, lightClientProgram.account.x1ValidatorSet.fetch(validatorSetPda)];
                case 1:
                    validatorSet = _a.sent();
                    currentVersion = validatorSet.version.toNumber();
                    console.log("\uD83D\uDCCA Validator Set Version: ".concat(currentVersion, "\n"));
                    // TEST 7.1: Same Validator Three Times
                    console.log('━'.repeat(60));
                    console.log('TEST 7.1: Same Validator Three Times');
                    console.log('━'.repeat(60));
                    BURN_NONCE_7_1 = parseInt(process.env.BURN_NONCE_7_1 || '0');
                    if (!(BURN_NONCE_7_1 > 0)) return [3 /*break*/, 16];
                    console.log("\n\uD83D\uDD25 Burn Nonce: ".concat(BURN_NONCE_7_1));
                    console.log('⏳ Waiting 20 seconds for finality...\n');
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 20000); })];
                case 2:
                    _a.sent();
                    // Get one attestation from V3
                    console.log('📡 Collecting attestation from V3...');
                    attestation = null;
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 8, , 9]);
                    return [4 /*yield*/, (0, node_fetch_1["default"])("".concat(VALIDATORS[0].api, "/attest-burn"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                burn_nonce: BURN_NONCE_7_1,
                                user: userKeypair.publicKey.toBase58(),
                                expected_amount: BURN_AMOUNT,
                                validator_set_version: currentVersion
                            })
                        })];
                case 4:
                    response = _a.sent();
                    if (!response.ok) return [3 /*break*/, 6];
                    return [4 /*yield*/, response.json()];
                case 5:
                    attestation = _a.sent();
                    console.log("   \u2705 ".concat(VALIDATORS[0].name, " signed"));
                    return [3 /*break*/, 7];
                case 6:
                    console.log("   \u274C ".concat(VALIDATORS[0].name, " failed"));
                    _a.label = 7;
                case 7: return [3 /*break*/, 9];
                case 8:
                    error_1 = _a.sent();
                    console.log("   \u274C ".concat(VALIDATORS[0].name, ": ").concat(error_1.message));
                    return [3 /*break*/, 9];
                case 9:
                    if (!attestation) return [3 /*break*/, 14];
                    console.log('\n📋 Creating duplicate: [V3, V3, V3]');
                    verifiedBurnPda = web3_js_1.PublicKey.findProgramAddressSync([
                        Buffer.from('verified_burn_v2'),
                        userKeypair.publicKey.toBuffer(),
                        new anchor.BN(BURN_NONCE_7_1).toArrayLike(Buffer, 'le', 8),
                    ], lightClientProgram.programId)[0];
                    duplicatedAttestations = [
                        attestation,
                        attestation,
                        attestation, // V3 again
                    ];
                    attestationData = {
                        burnNonce: new anchor.BN(BURN_NONCE_7_1),
                        user: userKeypair.publicKey,
                        amount: new anchor.BN(BURN_AMOUNT),
                        validatorSetVersion: new anchor.BN(currentVersion),
                        attestations: duplicatedAttestations.map(function (a) { return ({
                            validatorPubkey: new web3_js_1.PublicKey(a.validator_pubkey),
                            signature: a.signature,
                            timestamp: new anchor.BN(a.timestamp)
                        }); })
                    };
                    _a.label = 10;
                case 10:
                    _a.trys.push([10, 12, , 13]);
                    return [4 /*yield*/, lightClientProgram.methods
                            .submitBurnAttestation(attestationData)
                            .accounts({
                            user: userKeypair.publicKey,
                            validatorSet: validatorSetPda,
                            verifiedBurn: verifiedBurnPda,
                            systemProgram: web3_js_1.SystemProgram.programId
                        })
                            .rpc()];
                case 11:
                    tx = _a.sent();
                    console.log('\n❌ TEST FAILED: Same validator 3 times was accepted!');
                    console.log("\uD83D\uDCDD TX: ".concat(tx));
                    return [3 /*break*/, 13];
                case 12:
                    error_2 = _a.sent();
                    console.log('\n✅ TEST PASSED: Same validator 3 times rejected!');
                    if (error_2.message.includes('DuplicateValidator') || error_2.message.includes('0x1001')) {
                        console.log('🔒 Reason: DuplicateValidator error');
                    }
                    else {
                        console.log("\uD83D\uDCDD Error: ".concat(error_2.message.substring(0, 100)));
                    }
                    return [3 /*break*/, 13];
                case 13: return [3 /*break*/, 15];
                case 14:
                    console.log('\n❌ Could not collect attestation for test');
                    _a.label = 15;
                case 15: return [3 /*break*/, 17];
                case 16:
                    console.log('\n⚠️  Set BURN_NONCE_7_1 to run Test 7.1');
                    _a.label = 17;
                case 17:
                    // TEST 8.1: Unknown Validator
                    console.log('\n━'.repeat(60));
                    console.log('TEST 8.1: Unknown Validator (Not in Set)');
                    console.log('━'.repeat(60));
                    BURN_NONCE_8_1 = parseInt(process.env.BURN_NONCE_8_1 || '0');
                    if (!(BURN_NONCE_8_1 > 0)) return [3 /*break*/, 22];
                    console.log("\n\uD83D\uDD25 Burn Nonce: ".concat(BURN_NONCE_8_1));
                    fakeValidator = web3_js_1.Keypair.generate();
                    console.log("\uD83D\uDD0D Fake Validator: ".concat(fakeValidator.publicKey.toBase58()));
                    console.log('   (Not in validator set)');
                    verifiedBurnPda = web3_js_1.PublicKey.findProgramAddressSync([
                        Buffer.from('verified_burn_v2'),
                        userKeypair.publicKey.toBuffer(),
                        new anchor.BN(BURN_NONCE_8_1).toArrayLike(Buffer, 'le', 8),
                    ], lightClientProgram.programId)[0];
                    console.log('\n📋 Creating fake attestations from unknown validator...');
                    fakeAttestations = [
                        {
                            validatorPubkey: fakeValidator.publicKey,
                            signature: new Array(64).fill(1),
                            timestamp: new anchor.BN(Date.now() / 1000)
                        },
                        {
                            validatorPubkey: fakeValidator.publicKey,
                            signature: new Array(64).fill(2),
                            timestamp: new anchor.BN(Date.now() / 1000)
                        },
                        {
                            validatorPubkey: fakeValidator.publicKey,
                            signature: new Array(64).fill(3),
                            timestamp: new anchor.BN(Date.now() / 1000)
                        },
                    ];
                    attestationData = {
                        burnNonce: new anchor.BN(BURN_NONCE_8_1),
                        user: userKeypair.publicKey,
                        amount: new anchor.BN(BURN_AMOUNT),
                        validatorSetVersion: new anchor.BN(currentVersion),
                        attestations: fakeAttestations
                    };
                    _a.label = 18;
                case 18:
                    _a.trys.push([18, 20, , 21]);
                    return [4 /*yield*/, lightClientProgram.methods
                            .submitBurnAttestation(attestationData)
                            .accounts({
                            user: userKeypair.publicKey,
                            validatorSet: validatorSetPda,
                            verifiedBurn: verifiedBurnPda,
                            systemProgram: web3_js_1.SystemProgram.programId
                        })
                            .rpc()];
                case 19:
                    tx = _a.sent();
                    console.log('\n❌ TEST FAILED: Unknown validator was accepted!');
                    console.log("\uD83D\uDCDD TX: ".concat(tx));
                    return [3 /*break*/, 21];
                case 20:
                    error_3 = _a.sent();
                    console.log('\n✅ TEST PASSED: Unknown validator rejected!');
                    if (error_3.message.includes('ValidatorNotInSet') ||
                        error_3.message.includes('UnknownValidator') ||
                        error_3.message.includes('0x1002')) {
                        console.log('🔒 Reason: ValidatorNotInSet error');
                    }
                    else {
                        console.log("\uD83D\uDCDD Error: ".concat(error_3.message.substring(0, 100)));
                    }
                    return [3 /*break*/, 21];
                case 21: return [3 /*break*/, 23];
                case 22:
                    console.log('\n⚠️  Set BURN_NONCE_8_1 to run Test 8.1');
                    _a.label = 23;
                case 23:
                    // TEST 8.2: Mix of Valid and Unknown Validators
                    console.log('\n━'.repeat(60));
                    console.log('TEST 8.2: Mix of Valid and Unknown Validators');
                    console.log('━'.repeat(60));
                    BURN_NONCE_8_2 = parseInt(process.env.BURN_NONCE_8_2 || '0');
                    if (!(BURN_NONCE_8_2 > 0)) return [3 /*break*/, 39];
                    console.log("\n\uD83D\uDD25 Burn Nonce: ".concat(BURN_NONCE_8_2));
                    console.log('⏳ Waiting 20 seconds for finality...\n');
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 20000); })];
                case 24:
                    _a.sent();
                    // Get 2 valid attestations
                    console.log('📡 Collecting 2 valid attestations...');
                    validAttestations = [];
                    i = 0;
                    _a.label = 25;
                case 25:
                    if (!(i < 2)) return [3 /*break*/, 32];
                    _a.label = 26;
                case 26:
                    _a.trys.push([26, 30, , 31]);
                    return [4 /*yield*/, (0, node_fetch_1["default"])("".concat(VALIDATORS[i].api, "/attest-burn"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                burn_nonce: BURN_NONCE_8_2,
                                user: userKeypair.publicKey.toBase58(),
                                expected_amount: BURN_AMOUNT,
                                validator_set_version: currentVersion
                            })
                        })];
                case 27:
                    response = _a.sent();
                    if (!response.ok) return [3 /*break*/, 29];
                    return [4 /*yield*/, response.json()];
                case 28:
                    attestation = _a.sent();
                    validAttestations.push(attestation);
                    console.log("   \u2705 ".concat(VALIDATORS[i].name, " signed"));
                    _a.label = 29;
                case 29: return [3 /*break*/, 31];
                case 30:
                    error_4 = _a.sent();
                    console.log("   \u274C ".concat(VALIDATORS[i].name, ": ").concat(error_4.message));
                    return [3 /*break*/, 31];
                case 31:
                    i++;
                    return [3 /*break*/, 25];
                case 32:
                    if (!(validAttestations.length === 2)) return [3 /*break*/, 37];
                    fakeValidator = web3_js_1.Keypair.generate();
                    console.log("\n\uD83D\uDCCB Adding fake validator: ".concat(fakeValidator.publicKey.toBase58()));
                    console.log('   Creating array: [V3, V4, Unknown]');
                    verifiedBurnPda = web3_js_1.PublicKey.findProgramAddressSync([
                        Buffer.from('verified_burn_v2'),
                        userKeypair.publicKey.toBuffer(),
                        new anchor.BN(BURN_NONCE_8_2).toArrayLike(Buffer, 'le', 8),
                    ], lightClientProgram.programId)[0];
                    mixedAttestations = [
                        {
                            validatorPubkey: new web3_js_1.PublicKey(validAttestations[0].validator_pubkey),
                            signature: validAttestations[0].signature,
                            timestamp: new anchor.BN(validAttestations[0].timestamp)
                        },
                        {
                            validatorPubkey: new web3_js_1.PublicKey(validAttestations[1].validator_pubkey),
                            signature: validAttestations[1].signature,
                            timestamp: new anchor.BN(validAttestations[1].timestamp)
                        },
                        {
                            validatorPubkey: fakeValidator.publicKey,
                            signature: new Array(64).fill(99),
                            timestamp: new anchor.BN(Date.now() / 1000)
                        },
                    ];
                    attestationData = {
                        burnNonce: new anchor.BN(BURN_NONCE_8_2),
                        user: userKeypair.publicKey,
                        amount: new anchor.BN(BURN_AMOUNT),
                        validatorSetVersion: new anchor.BN(currentVersion),
                        attestations: mixedAttestations
                    };
                    _a.label = 33;
                case 33:
                    _a.trys.push([33, 35, , 36]);
                    return [4 /*yield*/, lightClientProgram.methods
                            .submitBurnAttestation(attestationData)
                            .accounts({
                            user: userKeypair.publicKey,
                            validatorSet: validatorSetPda,
                            verifiedBurn: verifiedBurnPda,
                            systemProgram: web3_js_1.SystemProgram.programId
                        })
                            .rpc()];
                case 34:
                    tx = _a.sent();
                    console.log('\n❌ TEST FAILED: Mixed valid/unknown validators accepted!');
                    console.log("\uD83D\uDCDD TX: ".concat(tx));
                    return [3 /*break*/, 36];
                case 35:
                    error_5 = _a.sent();
                    console.log('\n✅ TEST PASSED: Mixed validators rejected!');
                    if (error_5.message.includes('ValidatorNotInSet') ||
                        error_5.message.includes('UnknownValidator') ||
                        error_5.message.includes('0x1002')) {
                        console.log('🔒 Reason: ValidatorNotInSet error (detected unknown validator)');
                    }
                    else {
                        console.log("\uD83D\uDCDD Error: ".concat(error_5.message.substring(0, 100)));
                    }
                    return [3 /*break*/, 36];
                case 36: return [3 /*break*/, 38];
                case 37:
                    console.log("\n\u274C Only got ".concat(validAttestations.length, " valid attestations, need 2"));
                    _a.label = 38;
                case 38: return [3 /*break*/, 40];
                case 39:
                    console.log('\n⚠️  Set BURN_NONCE_8_2 to run Test 8.2');
                    _a.label = 40;
                case 40:
                    console.log('\n━'.repeat(60));
                    console.log('🎉 VALIDATOR INTEGRITY TESTS COMPLETE!');
                    console.log('━'.repeat(60));
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .then(function () { return process.exit(0); })["catch"](function (error) {
    console.error(error);
    process.exit(1);
});
