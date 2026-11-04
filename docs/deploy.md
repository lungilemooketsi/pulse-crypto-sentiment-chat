# Deploy

These steps create the Cloudflare Worker, the Cloudflare Pages project, and the Firestore rules. CI does not create those resources. After setup, the site deploys to Pages from `main` on its own (see [Deploys from `main`](#deploys-from-main)). The Worker and the Firestore rules are still deployed by hand.

The public site is [https://pulse.lungilemooketsi.engineer](https://pulse.lungilemooketsi.engineer).

The Worker is named `astro-pulse-api`. It calls Meta's Muse Spark (`muse-spark-1.3`) through the Meta Model API, with the key in the Worker secret `MODEL_API_KEY` (`npx wrangler secret put MODEL_API_KEY` from `worker/`). `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGINS` are plain vars in `worker/wrangler.jsonc`.

Those vars are already set for the live app:

- `FIREBASE_PROJECT_ID` is `astro-pulse-chat`.
- `ALLOWED_ORIGINS` is `https://pulse.lungilemooketsi.engineer,https://astro-pulse.pages.dev,http://localhost:8080,http://127.0.0.1:8080`.

Rate limits are approximate and counted separately in each Cloudflare location: 20 requests per 60 seconds per Firebase uid, and 60 requests per 60 seconds per IP. The first Worker deploy creates rate limiting namespaces `81001` and `81002`. Those ids must be unique in the account. If deploy reports a conflict, pick new `namespace_id` values and deploy again.

## 1. Firebase project

The Firebase project id is `astro-pulse-chat`.

1. Open that project in the [Firebase console](https://console.firebase.google.com/).
2. Add a Web app and copy its config into the Pages environment variables below.
3. Authentication → Sign-in method: enable **Google** and **Email/Password**.
4. Build → Firestore Database → Create database (Native mode) if it does not exist. Pick a region and start in production mode.
5. Authentication → Settings → Authorized domains: keep `localhost`, and add `pulse.lungilemooketsi.engineer` and `astro-pulse.pages.dev`.

From the repository root, with [Node.js 22](https://nodejs.org/) installed:

```sh
npx --yes firebase-tools@15 login
npx --yes firebase-tools@15 deploy --only firestore:rules --project astro-pulse-chat
```

`firebase.json` points at `firestore.rules`. Each signed-in user can read and write only `users/{their uid}/**`.

## 2. Worker

From `worker/`:

```sh
npm ci
npx wrangler login
npx wrangler deploy
```

This creates the Worker and the two rate limiting namespaces. Set the `MODEL_API_KEY` secret before the first chat. The deploy prints the `*.workers.dev` URL. That URL, with no path, is `VITE_API_URL`. The browser calls `POST ${VITE_API_URL}/chat`.

For local `npx wrangler dev`, the dev server listens on `http://localhost:8787`. Put `MODEL_API_KEY=<key>` in `worker/.dev.vars` (git-ignored) so local chats reach the Meta Model API.

## 3. Local frontend

From the repository root:

```sh
cp .env.example .env
```

Fill the public values. `VITE_FIREBASE_PROJECT_ID` is `astro-pulse-chat`. `VITE_API_URL` is `http://localhost:8787` for `wrangler dev`, or the deployed Worker origin in production. Vite inlines `VITE_*` at build time.

```sh
npm ci
npm run dev
```

The app is at `http://localhost:8080`.

## 4. Cloudflare Pages

Vite bakes `VITE_*` into the static build, so the Pages project needs those variables before the build runs. The production site is `https://pulse.lungilemooketsi.engineer`. The Pages hostname `https://astro-pulse.pages.dev` is also allowed to call the Worker.

Dashboard:

1. Workers & Pages → Create → Pages → Upload assets, or connect the Git repository.
2. Project name: `astro-pulse`
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Production branch: `main`
6. Environment variables, available to the build:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID` = `astro-pulse-chat`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_API_URL` = `https://astro-pulse-api.<account>.workers.dev`
7. Attach the custom domain `pulse.lungilemooketsi.engineer`.

Direct upload from the repository root, after `worker/` dependencies are installed so Wrangler is available:

```sh
npx --prefix worker wrangler pages project create astro-pulse --production-branch main
npm run build
npx --prefix worker wrangler pages deploy dist --project-name astro-pulse
```

For a Git-connected project, set the same build command, output directory, and environment variables in the Pages project settings, then push to `main`.

### Deploys from `main`

`astro-pulse` is a direct-upload project, so Cloudflare does not build it from Git. `.github/workflows/deploy.yml` does: when the `CI` workflow passes on a push to `main`, it builds that exact commit and runs `wrangler pages deploy dist --project-name astro-pulse --branch main`. It can also be run by hand from the Actions tab (Deploy → Run workflow), which deploys the current `main`.

The workflow reads these repository settings (Settings → Secrets and variables → Actions):

- Variables: the seven `VITE_*` values listed above, and `CLOUDFLARE_ACCOUNT_ID`. The `VITE_*` values are public and end up in the built JavaScript.
- Secret: `CLOUDFLARE_API_TOKEN`, an API token with the **Cloudflare Pages: Edit** permission on this account.

The deploy stops before uploading if a variable is missing or the build does not contain the Worker URL and Firebase config.
