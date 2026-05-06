import type { Conversation, Message, User } from "./types";

export const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error ?? "Request failed");
  }

  return (await response.json()) as T;
}

export const api = {
  me: () => request<{ user: User }>("/api/me"),
  users: () => request<{ users: User[] }>("/api/users"),
  conversations: () => request<{ conversations: Conversation[] }>("/api/conversations"),
  members: (conversationId: string) =>
    request<{ members: User[] }>(`/api/conversations/${conversationId}/members`),
  messages: (conversationId: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${conversationId}/messages`),
  createConversation: (name: string, memberIds: string[]) =>
    request<{ conversation: Conversation }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ name, memberIds })
    }),
  addMembers: (conversationId: string, memberIds: string[]) =>
    request<{ conversation: Conversation; memberIds: string[] }>(
      `/api/conversations/${conversationId}/members`,
      {
        method: "POST",
        body: JSON.stringify({ memberIds })
      }
    ),
  editMessage: (messageId: string, content: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content })
    }),
  deleteMessage: (messageId: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}`, {
      method: "DELETE"
    }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" })
};
