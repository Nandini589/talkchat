# Campus Chat

A realtime college chat application with:

- Next.js frontend with a responsive dark glass UI
- Node.js + Express backend
- Socket.IO WebSocket chat events
- Google OAuth login handled by the backend
- Supabase Postgres used only from the backend

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create backend environment file:

   ```bash
   cp backend/.env.example backend/.env
   ```

   Fill in:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `JWT_SECRET`

   Important: rotate any service-role key that was shared in chat or committed anywhere.

3. Create frontend environment file:

   ```bash
   cp frontend/.env.example frontend/.env.local
   ```

4. Run the SQL in `backend/supabase/schema.sql` inside the Supabase SQL editor.

5. Configure Google OAuth:

   - Authorized JavaScript origin: `http://localhost:4000`
   - Authorized redirect URI: `http://localhost:4000/auth/google/callback`

6. Start both apps:

   ```bash
   npm run dev
   ```

Frontend: `http://localhost:3000`

Backend: `http://localhost:4000`

## Architecture

The browser never uses Supabase credentials. It talks to the backend through REST endpoints and a WebSocket connection. The backend verifies the Google-authenticated session with an HTTP-only cookie, checks room membership, writes messages to Supabase, and broadcasts realtime updates to connected clients.
