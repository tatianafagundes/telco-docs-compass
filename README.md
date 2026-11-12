# Telco Docs Compass

Define all the roles you need to play to build aan application as per defined in the prompts and let's plan applying best practices, customer-first, apple-like experience for a documeent management saas for telecom aaligned with all telecom staandards

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://telco-docs-compass.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/39380b20-c297-4410-911b-25f1fb09c697).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Demo accounts and tests that need a backend

Ordinary `bun run test` runs offline and needs nothing. The access tests (`RUN_ACCESS_TESTS=1 bun run test`) and the scripts in `e2e/` sign in with the demo accounts on `@example.test`. Their shared password is not in the repository: export it as `DEMO_PASSWORD` before running them, and never commit it or paste it in a chat.

```sh
export DEMO_PASSWORD='<ask the project owner>'
RUN_ACCESS_TESTS=1 bun run test
python3 e2e/share-isolation.py
```
