export function generateLinuxSetupScript(origin: string, key: string): string {
  return `#!/bin/bash
sudo curl -L 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64' -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
sudo tee /etc/systemd/system/cloudflared-dns.service > /dev/null <<EOF
[Unit]
Description=DNS Worker DoH Proxy
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared proxy-dns --upstream ${origin}/${key} --port 53
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-dns
echo "DNS Worker DoH Proxy installed successfully."
echo "Please change your system DNS to 127.0.0.1"
`;
}
