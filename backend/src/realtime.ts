import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { createMessage, userBelongsToConversation } from "./routes.js";
import { getUserFromToken } from "./auth.js";

const parseCookies = (cookieHeader?: string) =>
  Object.fromEntries(
    (cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );

export const attachRealtimeServer = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: config.frontendUrl,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const user = await getUserFromToken(cookies[config.cookieName]);
      if (!user) {
        next(new Error("Unauthorized"));
        return;
      }

      socket.data.user = user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    socket.broadcast.emit("presence:online", {
      userId: user.id,
      name: user.name,
      avatarUrl: user.avatar_url
    });

    socket.on("conversation:join", async (conversationId: string) => {
      if (!(await userBelongsToConversation(user.id, conversationId))) return;
      socket.join(conversationId);
      socket.emit("conversation:joined", { conversationId });
    });

    socket.on(
      "message:send",
      async (
        payload: { conversationId: string; content: string },
        ack?: (response: { ok: boolean; error?: string }) => void
      ) => {
        try {
          if (!(await userBelongsToConversation(user.id, payload.conversationId))) {
            ack?.({ ok: false, error: "Not a member of this conversation" });
            return;
          }

          const content = payload.content.trim();
          if (!content || content.length > 2000) {
            ack?.({ ok: false, error: "Message must be between 1 and 2000 characters" });
            return;
          }

          const message = await createMessage(payload.conversationId, user.id, content);
          io.to(payload.conversationId).emit("message:new", { message });
          ack?.({ ok: true });
        } catch (error) {
          ack?.({
            ok: false,
            error: error instanceof Error ? error.message : "Could not send message"
          });
        }
      }
    );

    socket.on("typing:start", async (conversationId: string) => {
      if (!(await userBelongsToConversation(user.id, conversationId))) return;
      socket.to(conversationId).emit("typing:start", {
        conversationId,
        user: { id: user.id, name: user.name }
      });
    });

    socket.on("typing:stop", async (conversationId: string) => {
      if (!(await userBelongsToConversation(user.id, conversationId))) return;
      socket.to(conversationId).emit("typing:stop", {
        conversationId,
        userId: user.id
      });
    });

    socket.on("disconnect", () => {
      socket.broadcast.emit("presence:offline", { userId: user.id });
    });
  });

  return io;
};
