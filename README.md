# CubeRoom

## local

```sh
npm ci
npm run dev
```

```sh
npm run check            
npm test                  
npm run test:integration  
npm run build            
```

```sh
CUBEROOM_URL=http://127.0.0.1:5174 npx vitest run tests/room.integration.test.ts
```

## Deploy to Cloudflare

```sh
npx wrangler login
npm run deploy
```
