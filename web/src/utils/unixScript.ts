export function generateLinuxScript(dohUrl: string): string {
  return `sudo curl -L 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64' -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
sudo tee /etc/systemd/system/cloudflared-dns.service > /dev/null <<EOF
[Unit]
Description=ObexDNS DoH Proxy
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared proxy-dns --upstream ${dohUrl} --port 53
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-dns`;
}
