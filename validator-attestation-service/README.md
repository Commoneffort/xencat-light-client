# XENCAT Bridge V2 - Validator Attestation Service

**Official onboarding guide for XENCAT Bridge validators on X1 mainnet.**

## Table of Contents

1. [Overview](#overview)
2. [Validator Responsibilities](#validator-responsibilities)
3. [Security Requirements](#security-requirements)
4. [System Requirements](#system-requirements)
5. [Installation & Setup](#installation--setup)
6. [Configuration](#configuration)
7. [Running the Service](#running-the-service)
8. [Monitoring & Maintenance](#monitoring--maintenance)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)
11. [Security Best Practices](#security-best-practices)
12. [FAQ](#faq)

---

## Overview

### What is the XENCAT Bridge?

The XENCAT Bridge is a **trustless, immutable** light client bridge that verifies Solana burn proofs on X1 chain and mints XENCAT tokens. It uses a validator attestation model with Byzantine fault tolerance.

### Bridge Architecture (V2)

```
Solana Mainnet                     X1 Mainnet
┌─────────────────┐               ┌──────────────────┐
│  XENCAT Token   │               │  XENCAT Token    │
│  (Burned)       │               │  (Minted)        │
└────────┬────────┘               └────────▲─────────┘
         │                                  │
         │ 1. User burns XENCAT            │ 4. Mint with fees
         ▼                                  │
┌─────────────────┐               ┌────────┴─────────┐
│  Burn Program   │               │  Mint Program    │
│  PDA Created    │               │  V2 (Fee Dist)   │
└────────┬────────┘               └────────▲─────────┘
         │                                  │
         │                                  │ 3. Submit attestations
         │ 2. Request attestations          │    (threshold: 3/5)
         │    from validators               │
         ▼                                  │
┌─────────────────────────────────────────┴┐
│     5 Validator Attestation Services     │
│  (This is YOU - Running on your server)  │
│                                           │
│  Each validator:                          │
│  - Verifies burn on Solana (RPC)         │
│  - Checks finality (32 slots)            │
│  - Signs attestation (Ed25519)           │
│  - Returns signature to user             │
│  - Earns 0.01 XNT per mint               │
└───────────────────────────────────────────┘
```

### Your Role as a Validator

As a XENCAT Bridge validator, you:

1. **Verify** - Check that burns actually exist on Solana blockchain
2. **Attest** - Sign attestations for legitimate burns only
3. **Earn** - Receive 0.01 XNT fee for each successful mint
4. **Secure** - Maintain uptime and operational security

**This is a critical security role.** Compromising 3+ validators would break bridge security.

---

## Validator Responsibilities

### Primary Duties

✅ **Run attestation service 24/7** with high availability
✅ **Verify every burn** on Solana before signing
✅ **Enforce finality** (wait 32 slots before signing)
✅ **Maintain security** of validator private keys
✅ **Monitor service health** and respond to issues
✅ **Stay coordinated** with other validators for updates

### What You Verify

For every attestation request, your service MUST verify:

| Check | Verification | Critical? |
|-------|--------------|-----------|
| **Burn exists** | BurnRecord PDA exists on Solana | ✅ CRITICAL |
| **Correct user** | Burn user matches request | ✅ CRITICAL |
| **Correct amount** | Burn amount matches request | ✅ CRITICAL |
| **Finality** | Burn is ≥32 slots old (reorg protection) | ✅ CRITICAL |
| **Correct nonce** | Burn nonce matches request | ✅ CRITICAL |

**Never sign attestations without verifying all of the above.**

### Trust Model

**Security Assumption**: At least 3 of 5 validators are honest.

- **Byzantine Fault Tolerance**: Tolerates up to 2 malicious/offline validators
- **Threshold Governance**: 3-of-5 signatures required for operations
- **No Admin**: Validator set updates require threshold signatures only
- **Immutable** (planned): Programs will be made immutable after extensive testing

**Your responsibility**: Be one of the honest validators.

---

## Security Requirements

### Critical Security Rules

🔒 **NEVER share your validator private key**
🔒 **NEVER run validator service on compromised infrastructure**
🔒 **NEVER sign attestations without verifying burns on Solana**
🔒 **NEVER skip the 32-slot finality check**
🔒 **NEVER sign for amounts/users that don't match on-chain data**

### Validator Key Security

Your validator private key is your identity on the bridge. Protect it like you protect your X1 validator keys.

**Recommended Setup**:
- Store private key in encrypted `.env` file (chmod 600)
- Use dedicated server with firewall rules
- Restrict SSH access (key-based only, no password)
- Enable fail2ban and intrusion detection
- Monitor for unauthorized access attempts
- Backup key securely (encrypted, offline)

**If your key is compromised**:
1. Immediately notify other validators
2. Initiate validator set rotation via threshold governance
3. Rotate to new keypair
4. Investigate breach source

### Infrastructure Security

**Minimum requirements**:
- Dedicated server (not shared with unrelated services)
- Firewall: Only allow ports 22 (SSH), 80/443 (HTTPS)
- DDoS protection (recommended: Cloudflare)
- Automated security updates enabled
- Log monitoring and alerting
- Regular backups

### Operational Security

**Best practices**:
- Use HTTPS/TLS for API endpoints (Let's Encrypt)
- Rate limiting to prevent abuse
- Monitor for unusual attestation patterns
- Keep Solana RPC connection reliable (use paid tier if needed)
- Test updates on testnet before mainnet
- Coordinate with other validators for upgrades

---

## System Requirements

### Hardware

**Minimum**:
- **CPU**: 2 cores
- **RAM**: 4 GB
- **Storage**: 20 GB SSD
- **Network**: 100 Mbps, stable connection

**Recommended**:
- **CPU**: 4 cores
- **RAM**: 8 GB
- **Storage**: 50 GB SSD
- **Network**: 1 Gbps, redundant connection

### Software

- **OS**: Ubuntu 22.04 LTS (recommended) or compatible Linux
- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **PM2**: Latest (for production management)
- **Nginx**: Latest (for reverse proxy + HTTPS)

### Network

- **Public IP**: Required for API accessibility
- **Domain** (recommended): For HTTPS certificate
- **Ports**: 8080 (service), 80/443 (HTTP/HTTPS)
- **Firewall**: Configured to allow only necessary ports

### Solana RPC Access

You MUST have reliable access to Solana mainnet RPC.

**Options**:
1. **Public RPC** (free, rate-limited)
   - `https://api.mainnet-beta.solana.com`
   - May be slow or rate-limited during high traffic

2. **Paid RPC** (recommended for production)
   - [Helius](https://helius.dev/) - $99/month
   - [QuickNode](https://quicknode.com/) - $49/month
   - [Alchemy](https://www.alchemy.com/) - $199/month
   - [Triton](https://triton.one/) - Custom pricing

**Recommendation**: Use paid RPC for production to ensure reliability and low latency.

---

## Installation & Setup

### 1. Server Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install build tools
sudo apt install -y build-essential

# Install Nginx (for reverse proxy)
sudo apt install -y nginx certbot python3-certbot-nginx

# Configure firewall
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 2. Clone Repository

```bash
# Create directory for bridge
mkdir -p ~/xencat-bridge
cd ~/xencat-bridge

# Clone repository (adjust URL to your deployment method)
git clone https://github.com/yourusername/xencat-light-client.git
cd xencat-light-client/validator-attestation-service
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Generate or Import Validator Keypair

**Option A: Generate new keypair** (for new validators)

```bash
# Install Solana CLI if not already installed
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Generate new keypair
solana-keygen new --outfile ~/.config/solana/validator-keypair.json

# Get your public key
solana-keygen pubkey ~/.config/solana/validator-keypair.json
```

**Option B: Use existing keypair** (for X1 validators)

If you're already an X1 validator, you may use your existing validator key or generate a dedicated key for bridge operations.

### 5. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env file
nano .env
```

See [Configuration](#configuration) section below for details.

### 6. Test the Service

```bash
# Run in development mode
npm run dev

# In another terminal, test health endpoint
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "ok",
  "validator": "YOUR_VALIDATOR_PUBKEY",
  "solana_rpc": "https://api.mainnet-beta.solana.com"
}
```

---

## Configuration

### Environment Variables

Edit `.env` file with your configuration:

```bash
# Solana RPC endpoint (CRITICAL)
# Use a reliable RPC provider - public RPCs may be rate-limited
SOLANA_RPC=https://api.mainnet-beta.solana.com

# Your validator private key (CRITICAL - KEEP SECRET)
# Format: JSON array from solana-keygen output
VALIDATOR_PRIVATE_KEY=[1,2,3,...]

# Port for attestation service API
# Default: 8080 (will be proxied via Nginx)
PORT=8080

# Optional: Log level (debug, info, warn, error)
LOG_LEVEL=info
```

### Getting Your Private Key in JSON Format

```bash
# Display your keypair as JSON array
cat ~/.config/solana/validator-keypair.json
```

Copy the entire JSON array (e.g., `[1,2,3,...]`) and paste it as the value for `VALIDATOR_PRIVATE_KEY`.

**Security**: Ensure `.env` file permissions are restricted:

```bash
chmod 600 .env
```

### Nginx Configuration (Reverse Proxy + HTTPS)

Create Nginx config file:

```bash
sudo nano /etc/nginx/sites-available/xencat-validator
```

Add configuration:

```nginx
server {
    listen 80;
    server_name your-validator-domain.com;  # Replace with your domain

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/xencat-validator /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Enable HTTPS with Let's Encrypt

```bash
# Obtain SSL certificate
sudo certbot --nginx -d your-validator-domain.com

# Auto-renewal is configured automatically
# Test renewal:
sudo certbot renew --dry-run
```

---

## Running the Service

### Development Mode

```bash
npm run dev
```

Use for testing only. Not suitable for production.

### Production Mode with PM2

**Start service**:

```bash
pm2 start index.ts --name xencat-validator --interpreter ts-node
```

**Save PM2 configuration**:

```bash
pm2 save
```

**Enable auto-start on boot**:

```bash
pm2 startup
# Follow the instructions printed by PM2
```

**PM2 Management Commands**:

```bash
# View logs
pm2 logs xencat-validator

# Monitor status
pm2 monit

# Restart service
pm2 restart xencat-validator

# Stop service
pm2 stop xencat-validator

# View detailed info
pm2 show xencat-validator
```

### Verify Service is Running

```bash
# Check PM2 status
pm2 status

# Test health endpoint
curl https://your-validator-domain.com/health

# Check Nginx status
sudo systemctl status nginx
```

---

## Monitoring & Maintenance

### Health Monitoring

**Health Endpoint**: `GET /health`

```bash
curl https://your-validator-domain.com/health
```

Expected response:
```json
{
  "status": "ok",
  "validator": "9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH",
  "solana_rpc": "https://api.mainnet-beta.solana.com"
}
```

**Setup automated monitoring** (recommended):

```bash
# Install uptime monitoring (e.g., UptimeRobot, Pingdom, or self-hosted)
# Configure alerts for:
# - Health endpoint down
# - High response time (>5 seconds)
# - Unusual error rates
```

### Log Monitoring

**View live logs**:

```bash
pm2 logs xencat-validator --lines 100
```

**Important log patterns to monitor**:

| Log Pattern | Meaning | Action |
|-------------|---------|--------|
| `✅ Attestation signed` | Normal operation | None |
| `⚠️ Burn not finalized` | User requested too early | None (expected) |
| `❌ Burn not found` | User error or chain issue | Investigate if frequent |
| `❌ Amount mismatch` | Potential attack attempt | **Alert immediately** |
| `❌ User mismatch` | Potential attack attempt | **Alert immediately** |
| `Error fetching burn` | RPC issue | Check Solana RPC status |

**Setup log rotation**:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 30
```

### Performance Metrics

Monitor these metrics:

- **Request rate**: Typical: 1-10 requests/hour
- **Response time**: Should be <2 seconds
- **Success rate**: Should be >95%
- **Solana RPC latency**: Should be <500ms

### Updates & Upgrades

**Before updating**:

1. Test on separate server/testnet first
2. Coordinate with other validators (schedule downtime)
3. Backup configuration and logs
4. Ensure at least 3 validators remain online

**Update process**:

```bash
cd ~/xencat-bridge/xencat-light-client
git pull origin main
cd validator-attestation-service
npm install
pm2 restart xencat-validator
pm2 logs xencat-validator  # Monitor for errors
```

### Incident Response

**If your service goes down**:

1. Check PM2 status: `pm2 status`
2. Check logs: `pm2 logs xencat-validator`
3. Restart if needed: `pm2 restart xencat-validator`
4. Notify other validators if extended downtime expected

**If you detect suspicious activity**:

1. Stop signing immediately (stop service)
2. Notify other validators via secure channel
3. Investigate logs for attack patterns
4. Only resume after confirming safety

---

## API Reference

### POST /attest-burn

Request a burn attestation from this validator.

**Request Body**:
```json
{
  "burn_nonce": 123,
  "user": "6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW",
  "expected_amount": 10000000,
  "validator_set_version": 1
}
```

**Parameters**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `burn_nonce` | number | Yes | Burn nonce from Solana |
| `user` | string | Yes | User public key who burned |
| `expected_amount` | number | Yes | Expected burn amount (6 decimals) |
| `validator_set_version` | number | Yes | Current validator set version |

**Success Response (200)**:
```json
{
  "burn_nonce": 123,
  "user": "6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW",
  "amount": 10000000,
  "slot": 250000000,
  "validator_pubkey": "9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH",
  "signature": [1, 2, 3, ...],  // 64-byte Ed25519 signature
  "timestamp": 1703456789000
}
```

**Error Responses**:

| Status | Error | Reason |
|--------|-------|--------|
| 400 | Missing required fields | Invalid request format |
| 404 | Burn not found | Burn doesn't exist on Solana |
| 400 | Amount mismatch | Burn amount ≠ expected_amount |
| 400 | User mismatch | Burn user ≠ requested user |
| 425 | Burn not yet finalized | <32 slots old (reorg risk) |
| 500 | Internal error | RPC error or service issue |

**Example Request**:

```bash
curl -X POST https://your-validator-domain.com/attest-burn \
  -H "Content-Type: application/json" \
  -d '{
    "burn_nonce": 123,
    "user": "6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW",
    "expected_amount": 10000000,
    "validator_set_version": 1
  }'
```

### GET /health

Health check endpoint for monitoring.

**Success Response (200)**:
```json
{
  "status": "ok",
  "validator": "9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH",
  "solana_rpc": "https://api.mainnet-beta.solana.com",
  "version": "2.0.0"
}
```

**Example Request**:

```bash
curl https://your-validator-domain.com/health
```

---

## Troubleshooting

### Service Won't Start

**Symptom**: `pm2 start` fails or service crashes immediately

**Solutions**:

1. **Check .env file**:
   ```bash
   cat .env  # Verify VALIDATOR_PRIVATE_KEY is set correctly
   ```

2. **Verify Node.js version**:
   ```bash
   node --version  # Should be v18.x or higher
   ```

3. **Check for port conflicts**:
   ```bash
   sudo lsof -i :8080  # Should show no conflicts
   ```

4. **Review logs**:
   ```bash
   pm2 logs xencat-validator --err
   ```

### Attestation Requests Failing

**Symptom**: Users report your validator is rejecting attestations

**Solutions**:

1. **Check Solana RPC connectivity**:
   ```bash
   curl https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

2. **Verify burn exists on Solana**:
   ```bash
   # Use Solana Explorer
   # Search for burn_nonce PDA or transaction
   ```

3. **Check finality window**:
   - Ensure burn is at least 32 slots old
   - Current implementation waits for finality automatically

4. **Review service logs** for specific error:
   ```bash
   pm2 logs xencat-validator | grep "ERROR"
   ```

### High Response Times

**Symptom**: Attestation requests take >5 seconds

**Solutions**:

1. **Switch to paid Solana RPC**:
   - Public RPCs are often rate-limited
   - See [Solana RPC Access](#solana-rpc-access)

2. **Check server resources**:
   ```bash
   htop  # Monitor CPU/RAM usage
   ```

3. **Verify network latency**:
   ```bash
   ping api.mainnet-beta.solana.com
   ```

### Invalid Signature Errors

**Symptom**: On-chain program rejects your signatures

**Solutions**:

1. **Verify validator public key matches on-chain**:
   ```bash
   # Your validator pubkey:
   solana-keygen pubkey ~/.config/solana/validator-keypair.json

   # Compare with validator set on X1
   ```

2. **Ensure using correct validator set version**:
   - Version must match current on-chain version
   - Check validator set: contact other validators or query on-chain

3. **Verify signature format**:
   - Should be 64-byte Ed25519 signature
   - Message format must match on-chain expectations

### Service Crashes Frequently

**Symptom**: PM2 shows multiple restarts

**Solutions**:

1. **Check for memory leaks**:
   ```bash
   pm2 monit  # Monitor memory usage over time
   ```

2. **Update dependencies**:
   ```bash
   npm update
   pm2 restart xencat-validator
   ```

3. **Enable PM2 auto-restart with max retries**:
   ```bash
   pm2 start index.ts --name xencat-validator --interpreter ts-node --max-restarts 10
   ```

4. **Review error logs** for patterns:
   ```bash
   pm2 logs xencat-validator --err --lines 1000
   ```

---

## Security Best Practices

### Key Management

✅ **DO**:
- Store private key in encrypted `.env` file (chmod 600)
- Backup private key in encrypted, offline storage
- Use different keys for different environments (testnet vs mainnet)
- Rotate keys periodically (coordinate with other validators)

❌ **DON'T**:
- Commit private keys to git
- Share private keys via insecure channels (Slack, email)
- Store private keys in plain text
- Use same key for multiple purposes

### Server Hardening

```bash
# Disable root SSH login
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
# Set: PasswordAuthentication no

# Enable firewall
sudo ufw enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Install fail2ban
sudo apt install fail2ban
sudo systemctl enable fail2ban

# Enable automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### Monitoring & Alerts

Setup automated alerts for:

- Service downtime (>5 minutes)
- High error rate (>10% of requests)
- Suspicious attestation patterns (amount/user mismatches)
- Unauthorized SSH login attempts
- Disk space low (<10% free)
- High CPU/memory usage (>80% sustained)

**Recommended tools**:
- [UptimeRobot](https://uptimerobot.com/) (free tier available)
- [Prometheus](https://prometheus.io/) + [Grafana](https://grafana.com/) (self-hosted)
- [Datadog](https://www.datadoghq.com/) (paid, comprehensive)

### Incident Response Plan

**If your validator is compromised**:

1. **Immediately**: Stop the service
   ```bash
   pm2 stop xencat-validator
   ```

2. **Notify**: Contact other validators via secure channel (Signal, PGP-encrypted email)

3. **Investigate**: Review logs for unauthorized access
   ```bash
   sudo lastlog  # Check recent logins
   sudo journalctl -u ssh  # Check SSH logs
   pm2 logs xencat-validator --lines 10000  # Check service logs
   ```

4. **Rotate keys**: Generate new validator keypair
   ```bash
   solana-keygen new --outfile ~/.config/solana/new-validator-keypair.json
   ```

5. **Coordinate**: Work with other validators to update validator set on-chain

6. **Resume**: Only after confirming system is secure

---

## FAQ

### Q: How much XNT do I earn per attestation?

**A**: 0.01 XNT per successful mint. This is paid automatically during the minting transaction. No withdrawal needed—fees are sent directly to your validator address.

### Q: What happens if I go offline?

**A**: The bridge uses a 3-of-5 threshold. If you're offline:
- Bridge continues to operate (users get attestations from other 4 validators)
- You miss out on fees for burns processed while offline
- If 2 validators are offline simultaneously, bridge still works (at minimum threshold)
- If 3+ validators offline, bridge halts until validators come back online

**Important**: Maintain high uptime to maximize earnings and bridge reliability.

### Q: Can I change my validator key?

**A**: Yes, but requires coordination:
1. Generate new keypair
2. Coordinate with other validators
3. Submit `update_validator_set` transaction (requires 3-of-5 threshold signatures)
4. Update `.env` with new key
5. Restart service

### Q: How do I know which validator set version to use?

**A**: Query the on-chain validator set:

```bash
# Using Solana CLI (connected to X1)
solana account GPzF2wcsV5PxWTQRNGRPmkTZPiDM1kcFfpiCGeraXnSJ --url https://rpc.mainnet.x1.xyz
```

Or check with other validators. Version is currently **1** (as of Dec 2025).

### Q: What if I detect an attack attempt?

**A**: Your service automatically rejects invalid requests (wrong amount, wrong user, non-existent burns). However, if you see patterns suggesting coordinated attacks:

1. Document the evidence (logs, request patterns)
2. Notify other validators immediately
3. Consider temporarily stopping service if attack is severe
4. DO NOT sign attestations you're unsure about

**Remember**: Signing bad attestations compromises bridge security.

### Q: How do validator set updates work?

**A**: Trustless threshold governance:
- **Requires**: 3 of 5 current validators must sign update
- **Process**: Validators create signed message with new validator set + threshold
- **Submission**: Any validator submits `update_validator_set` transaction with signatures
- **Effect**: Version increments, old attestations become invalid

**Coordination required** - work with other validators via secure communication.

### Q: Are the programs immutable?

**A**: **Not yet** (as of Dec 2025). Programs currently have upgrade authority:
- Light Client: `BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5`
- Mint Program: `8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk`
- Upgrade Authority: `9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH` (Validator 1)

**Planned**: Programs will be made immutable after extensive mainnet usage and professional security audit.

### Q: Can I run multiple validators?

**A**: Technically yes, but each validator needs:
- Separate server infrastructure
- Separate keypair
- Separate domain/IP

**Note**: Running multiple validators doesn't increase earning—each validator earns the same fee per mint. Better to run one reliable validator.

### Q: What's the expected request volume?

**A**: Highly variable:
- **Typical**: 1-10 attestation requests per hour
- **Peak**: 100+ requests per hour during high activity
- **Idle periods**: Hours with zero requests

**Prepare for**: Burst traffic handling, especially during promotional events or token launches.

### Q: How do I backup my validator key?

**A**:

```bash
# Backup to encrypted USB drive
gpg --symmetric ~/.config/solana/validator-keypair.json
# Copy encrypted file to offline storage

# To restore:
gpg --decrypt validator-keypair.json.gpg > ~/.config/solana/validator-keypair.json
chmod 600 ~/.config/solana/validator-keypair.json
```

**Store backups**:
- Offline (USB drive, paper wallet)
- Encrypted (GPG, BitLocker, VeraCrypt)
- Multiple locations (safe deposit box, secure home safe)

---

## Getting Help

### Support Channels

- **GitHub Issues**: [xencat-light-client/issues](https://github.com/yourusername/xencat-light-client/issues)
- **Validator Coordination**: [Secure validator chat - Signal/Discord]
- **Emergency Contact**: [validator-emergency@example.com]

### Reporting Security Issues

**DO NOT** report security vulnerabilities via public GitHub issues.

**Instead**:
1. Email: [security@example.com] (PGP key available)
2. Signal: [+1-xxx-xxx-xxxx]
3. Include: Detailed description, reproduction steps, impact assessment

---

## Version History

- **v2.0.0** (Dec 2025) - V2 migration with per-validator fee distribution
- **v1.0.0** (Dec 2024) - Initial mainnet launch

---

## License

This project is part of the XENCAT Bridge and follows the same license as the main repository.

---

**Document Version**: 1.0.0
**Last Updated**: December 27, 2025
**Maintained By**: XENCAT Bridge Team

**Validator Status**: ✅ Production Ready | Fee: 0.01 XNT/mint | Threshold: 3/5
