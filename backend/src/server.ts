import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import http from "http";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { setAuthCookie, signAuthToken } from "./auth.js";
import { config } from "./config.js";
import apiRouter, { ensureGeneralMembership, setRealtimeServer } from "./routes.js";
import { supabase } from "./supabase.js";
import { attachRealtimeServer } from "./realtime.js";
import type { User } from "./types.js";

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

passport.use(
  new GoogleStrategy(
    {
      clientID: config.googleClientId,
      clientSecret: config.googleClientSecret,
      callbackURL: config.googleCallbackUrl
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          done(new Error("Google account does not expose an email address"));
          return;
        }

        const avatarUrl = await resolveAvatarUrl(profile.id, profile.photos?.[0]?.value);

        const { data, error } = await supabase
          .from("users")
          .upsert(
            {
              google_id: profile.id,
              email,
              name: profile.displayName || email.split("@")[0],
              avatar_url: avatarUrl
            },
            { onConflict: "google_id" }
          )
          .select("*")
          .single<User>();

        if (error || !data) {
          done(error ?? new Error("Could not save user"));
          return;
        }

        await ensureGeneralMembership(data.id);
        done(null, data);
      } catch (error) {
        done(error);
      }
    }
  )
);

const resolveAvatarUrl = async (googleId: string, googleAvatarUrl?: string) => {
  const { data: existingUser } = await supabase
    .from("users")
    .select("avatar_url")
    .eq("google_id", googleId)
    .maybeSingle<Pick<User, "avatar_url">>();

  if (existingUser?.avatar_url?.startsWith("data:image/")) {
    return existingUser.avatar_url;
  }

  if (!googleAvatarUrl) {
    return existingUser?.avatar_url ?? null;
  }

  try {
    const response = await fetch(googleAvatarUrl);
    if (!response.ok) {
      return existingUser?.avatar_url ?? googleAvatarUrl;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return existingUser?.avatar_url ?? googleAvatarUrl;
  }
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "campus-chat-backend" });
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false
  })
);

app.get(
  "/auth/google/callback",
  (req, res, next) => {
    passport.authenticate("google", { session: false }, (error: unknown, user?: User) => {
      if (error || !user) {
        console.error("Google OAuth callback failed", {
          message: error instanceof Error ? error.message : "No user returned",
          details:
            typeof error === "object" && error !== null && "oauthError" in error
              ? (error as { oauthError?: unknown }).oauthError
              : undefined
        });
        res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
        return;
      }

      req.user = user;
      next();
    })(req, res, next);
  },
  (req, res) => {
    const token = signAuthToken(req.user as User);
    setAuthCookie(res, token);
    res.redirect(`${config.frontendUrl}/chat`);
  }
);

const io = attachRealtimeServer(server);
setRealtimeServer(io);

app.use("/api", apiRouter);

server.listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
