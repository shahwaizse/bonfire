# Frontend Notes

This is a Vite + React app, not Next.js.

- Entry point: `src/main.tsx`
- Main shell: `src/components/ChatApp.tsx`
- Styling: Tailwind v4 via `src/styles.css`
- Backend URL: `VITE_BACKEND_URL`, with `http://127.0.0.1:8000` fallback
- Keep the app client-only unless there is a clear reason to add a server layer.
