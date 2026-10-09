---
title: Post-Quantum Zero-Knowledge E2EE
description: Architectural breakdown of NIST FIPS 203 ML-KEM-768, hardware Passkeys, and hourly rotating KEM DEKs.
---

DNS Worker provides an industry-leading **Post-Quantum Zero-Knowledge End-to-End Encryption (E2EE)** architecture for query logging, ensuring historical DNS traffic remains mathematically irreversible even under future quantum computer attacks.

## Default State & Activation

> [!NOTE]
> **Disabled by Default**: E2EE is **turned off by default** for all accounts. By default, DNS query logs are stored directly as standard unencrypted records, delivering optimal throughput, immediate readability across all devices, and zero client decryption overhead.

### How to Enable E2EE (Opt-In)

If you require mathematical zero-knowledge privacy for your DNS query logs:

1. Navigate to **Account & Security** -> **E2EE (End-to-End Encryption)** card.
2. Click **Generate Keypair with Passkey** (recommended for seamless biometric unlock) or **Init with Recovery Key**.
3. Once initialized, all newly incoming DNS query logs will be encrypted using NIST FIPS 203 **P256-MLKEM768** before being persisted.
4. You can pause/toggle E2EE off or re-enable it at any time without deleting your historical keys.

## Core Security Pillars

1. **Zero-Knowledge Storage**:
   - The DNS Worker backend encrypts incoming query metadata solely using the public key;
   - Decryption keys are never stored in the database.
2. **NIST FIPS 203 Hybrid Lattice Cryptography**:
   - Combines classical elliptic curve cryptography with **P256-MLKEM768**, offering quantum resistance against Shor's algorithm.
3. **Hourly Rotating KEM DEKs**:
   - Data Encryption Keys rotate every hour, minimizing exposure windows.
4. **Hardware Passkey Protection (WebAuthn)**:
   - Users decrypt the master recovery key using biometrics (Touch ID, Face ID, Windows Hello, or YubiKey). Private key decryption occurs strictly in-browser on authorized devices.
