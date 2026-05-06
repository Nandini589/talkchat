import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthToken, User as AppUser } from "./types.js";
import { config } from "./config.js";
import { supabase } from "./supabase.js";

declare global {
  namespace Express {
    interface Request {
      currentUser?: AppUser;
    }
  }
}

export const signAuthToken = (user: AppUser) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name
    } satisfies AuthToken,
    config.jwtSecret,
    { expiresIn: "7d" }
  );

export const setAuthCookie = (res: Response, token: string) => {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

export const clearAuthCookie = (res: Response) => {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
};

export const verifyToken = (token: string): AuthToken =>
  jwt.verify(token, config.jwtSecret) as AuthToken;

export const getUserFromToken = async (token?: string) => {
  if (!token) return null;

  const payload = verifyToken(token);
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", payload.sub)
    .single<AppUser>();

  if (error || !data) return null;
  return data;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUserFromToken(req.cookies?.[config.cookieName]);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    req.currentUser = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
};
