#!/usr/bin/env bash
# ==============================================================================
# Linux OS & Network Stack Performance Tuning for DNS Worker
# Optimizes UDP socket buffers, packet queues, and file descriptor limits
# ==============================================================================

set -euo pipefail

SYSCTL_CONF="/etc/sysctl.d/99-dns-worker.conf"

echo "Configuring high-throughput kernel network parameters for DNS Worker..."

cat << 'EOF' | sudo tee "${SYSCTL_CONF}" > /dev/null
# ==============================================================================
# DNS Worker - Kernel Network & Socket Buffer Optimization
# ==============================================================================
# Increase maximum socket receive and send buffer sizes to 16MB
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216

# Increase default socket buffer sizes
net.core.rmem_default = 262144
net.core.wmem_default = 262144

# Increase network device backlog queue length to prevent packet drop on burst
net.core.netdev_max_backlog = 10000

# Increase UDP memory allocations (pages: min, default, max)
net.ipv4.udp_rmem_min = 16384
net.ipv4.udp_wmem_min = 16384
EOF

sudo sysctl --system > /dev/null || sudo sysctl -p "${SYSCTL_CONF}"

echo "Successfully applied kernel network optimizations to ${SYSCTL_CONF}!"
