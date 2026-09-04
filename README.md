# vinext app

This project was created with create-vinext-app.

## Scripts

- `pnpm run dev` starts the vinext dev server.
- `pnpm run build` builds the Cloudflare Worker output.
- `pnpm run start` starts the built Worker locally with Wrangler.
- `pnpm run deploy` deploys the Cloudflare Worker.

## Development on a new machine

### Prerequisites

Install Git, Node.js, npm, and `cloudflared`. On Ubuntu or Debian, install `cloudflared` with:

```sh
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared
```

### Run the app

Clone the repository and install its dependencies:

```sh
git clone https://github.com/AlexandruDanCroitoriu/free-spirit-dance.git
cd free-spirit-dance
npm install
```

The development command starts both the Vinext server and the named Cloudflare Tunnel:

```sh
npm run dev
```

Open the authenticated local app at:

```text
https://dev-free-spirit-dance.alexandru-croitoriu.dev
```

### Tunnel setup

Cloudflare Access and Google OAuth are configured remotely and do not need to be recreated. The new machine does need access to the tunnel credentials.

Authenticate `cloudflared`:

```sh
cloudflared tunnel login
```

Then securely copy the existing tunnel credentials JSON to `~/.cloudflared/` and create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /home/YOUR_USER/.cloudflared/YOUR_TUNNEL_UUID.json

ingress:
	- hostname: dev-free-spirit-dance.alexandru-croitoriu.dev
		service: http://localhost:3000
	- service: http_status:404
```

Replace `YOUR_TUNNEL_UUID` and `YOUR_USER` with the appropriate values. Never commit the tunnel credentials, `config.yml`, or Google OAuth secrets to the repository.

If the existing tunnel credentials cannot be transferred, create a new named tunnel and update the hostname route and `config.yml` accordingly.

