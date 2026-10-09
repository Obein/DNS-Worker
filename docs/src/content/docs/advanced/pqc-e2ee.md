---
title: Post-Quantum Zero-Knowledge E2EE
description: Architectural breakdown of NIST FIPS 203 ML-KEM-768, hardware Passkeys, and hourly rotating KEM DEKs.
---

DNS Worker provides an industry-leading **Post-Quantum Zero-Knowledge End-to-End Encryption (E2EE)** architecture for query logging, ensuring historical DNS traffic remains mathematically irreversible even under future quantum computer attacks.

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
