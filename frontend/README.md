# Auto-Drive (Front-End)

This application is the frontend for interacting with Auto-Drive's API.

This application enables the user to:

- Upload files
- Download files
- Create API Keys
- Share files

## Getting Started

To clone the repository, run the following command in your terminal:

```bash
git clone https://github.com/autonomys/auto-drive

cd auto-drive/frontend
```

Once the repository is cloned, you need to setup your enviroment.

Execute this command for creating the enviroment file and then fulfill every missing entry.

```
cp .env.sample .env.local
```

Install dependencies with this command:

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

Once, all this is setup you can launch it with:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:8080](http://localhost:8080) with your browser to see the result.
