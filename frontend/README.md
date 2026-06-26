# Frontend

Vite + React chat UI for the local Bonfire backend.

## Commands

```powershell
npm install
npm run start    # Vite dev server on http://127.0.0.1:3000
npm run build    # TypeScript check + production bundle
npm run preview  # Serve the production bundle
npm run lint     # TypeScript check only
```

The backend URL is read from `VITE_BACKEND_URL` in `.env.local`, falling back
to `http://127.0.0.1:8000`.
