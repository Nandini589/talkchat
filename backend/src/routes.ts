import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { clearAuthCookie, requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import type { Conversation, Message, User } from "./types.js";

const router = Router();
let realtimeServer: Server | null = null;

export const setRealtimeServer = (io: Server) => {
  realtimeServer = io;
};

const conversationInput = z.object({
  name: z.string().min(2).max(80),
  memberIds: z.array(z.string().uuid()).default([])
});

const membersInput = z.object({
  memberIds: z.array(z.string().uuid()).min(1)
});

const messageInput = z.object({
  content: z.string().trim().min(1).max(2000)
});

const messageUpdateInput = z.object({
  content: z.string().trim().min(1).max(2000)
});

const messageSelect =
  "*, users!messages_sender_id_fkey(id, name, avatar_url), message_reads(user_id, read_at, users!message_reads_user_id_fkey(id, name, avatar_url))";

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.currentUser });
});

router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/users", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, avatar_url, created_at")
    .neq("id", req.currentUser!.id)
    .order("name");

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ users: data });
});

router.get("/conversations", requireAuth, async (req, res) => {
  await ensureGeneralMembership(req.currentUser!.id);

  const { data: memberships, error } = await supabase
    .from("conversation_members")
    .select("conversation_id, conversations(*)")
    .eq("user_id", req.currentUser!.id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const conversations = memberships
    .map((row) => row.conversations as unknown as Conversation | null)
    .filter(Boolean)
    .sort((a, b) => b!.created_at.localeCompare(a!.created_at));

  res.json({ conversations });
});

router.post("/conversations", requireAuth, async (req, res) => {
  const parsed = conversationInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      name: parsed.data.name,
      is_group: true,
      created_by: req.currentUser!.id
    })
    .select("*")
    .single<Conversation>();

  if (error || !conversation) {
    res.status(500).json({ error: error?.message ?? "Could not create conversation" });
    return;
  }

  const memberIds = Array.from(new Set([req.currentUser!.id, ...parsed.data.memberIds]));
  const memberRows = memberIds.map((userId) => ({
    conversation_id: conversation.id,
    user_id: userId
  }));

  const { error: memberError } = await supabase.from("conversation_members").insert(memberRows);
  if (memberError) {
    res.status(500).json({ error: memberError.message });
    return;
  }

  memberIds.forEach((userId) => {
    realtimeServer?.to(`user:${userId}`).emit("conversation:new", { conversation });
  });

  res.status(201).json({ conversation });
});

router.post("/conversations/:id/members", requireAuth, async (req, res) => {
  const conversationId = String(req.params.id);
  const parsed = membersInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const isMember = await userBelongsToConversation(req.currentUser!.id, conversationId);
  if (!isMember) {
    res.status(403).json({ error: "You are not a member of this conversation" });
    return;
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single<Conversation>();

  if (conversationError || !conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const memberIds = Array.from(new Set(parsed.data.memberIds));
  const memberRows = memberIds.map((userId) => ({
    conversation_id: conversationId,
    user_id: userId
  }));

  const { error: memberError } = await supabase
    .from("conversation_members")
    .upsert(memberRows, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });

  if (memberError) {
    res.status(500).json({ error: memberError.message });
    return;
  }

  memberIds.forEach((userId) => {
    realtimeServer?.to(`user:${userId}`).emit("conversation:new", { conversation });
  });

  realtimeServer?.to(conversationId).emit("conversation:members-added", {
    conversationId,
    memberIds,
    addedBy: req.currentUser!.id
  });

  res.json({ conversation, memberIds });
});

router.get("/conversations/:id/members", requireAuth, async (req, res) => {
  const conversationId = String(req.params.id);
  const isMember = await userBelongsToConversation(req.currentUser!.id, conversationId);
  if (!isMember) {
    res.status(403).json({ error: "You are not a member of this conversation" });
    return;
  }

  const { data, error } = await supabase
    .from("conversation_members")
    .select("users(id, email, name, avatar_url, created_at)")
    .eq("conversation_id", conversationId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const members = data
    .map((row) => row.users as unknown as User | null)
    .filter(Boolean)
    .sort((a, b) => a!.name.localeCompare(b!.name));

  res.json({ members });
});

router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  const conversationId = String(req.params.id);
  const isMember = await userBelongsToConversation(req.currentUser!.id, conversationId);
  if (!isMember) {
    res.status(403).json({ error: "You are not a member of this conversation" });
    return;
  }

  const readMessageIds = await markConversationMessagesRead(conversationId, req.currentUser!.id);
  if (readMessageIds.length > 0) {
    realtimeServer?.to(conversationId).emit("message:read", {
      conversationId,
      messageIds: readMessageIds,
      reader: {
        id: req.currentUser!.id,
        name: req.currentUser!.name,
        avatar_url: req.currentUser!.avatar_url
      },
      readAt: new Date().toISOString()
    });
  }

  const { data, error } = await supabase
    .from("messages")
    .select(messageSelect)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(100)
    .returns<Message[]>();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ messages: data });
});

router.patch("/messages/:id", requireAuth, async (req, res) => {
  const messageId = String(req.params.id);
  const parsed = messageUpdateInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await getMessageById(messageId);
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  if (existing.sender_id !== req.currentUser!.id) {
    res.status(403).json({ error: "Only the sender can edit this message" });
    return;
  }

  if (existing.deleted_at) {
    res.status(400).json({ error: "Deleted messages cannot be edited" });
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .update({
      content: parsed.data.content,
      edited_at: new Date().toISOString()
    })
    .eq("id", messageId)
    .select(messageSelect)
    .single<Message>();

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? "Could not edit message" });
    return;
  }

  realtimeServer?.to(data.conversation_id).emit("message:updated", { message: data });
  res.json({ message: data });
});

router.delete("/messages/:id", requireAuth, async (req, res) => {
  const messageId = String(req.params.id);
  const existing = await getMessageById(messageId);
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  if (existing.sender_id !== req.currentUser!.id) {
    res.status(403).json({ error: "Only the sender can delete this message" });
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId)
    .select(messageSelect)
    .single<Message>();

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? "Could not delete message" });
    return;
  }

  realtimeServer?.to(data.conversation_id).emit("message:deleted", { message: data });
  res.json({ message: data });
});

router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  const conversationId = String(req.params.id);
  const parsed = messageInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const isMember = await userBelongsToConversation(req.currentUser!.id, conversationId);
  if (!isMember) {
    res.status(403).json({ error: "You are not a member of this conversation" });
    return;
  }

  const message = await createMessage(conversationId, req.currentUser!.id, parsed.data.content);
  res.status(201).json({ message });
});

export const ensureGeneralMembership = async (userId: string) => {
  const { data: general, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("name", "General")
    .maybeSingle<{ id: string }>();

  if (conversationError || !general) return;

  await supabase.from("conversation_members").upsert({
    conversation_id: general.id,
    user_id: userId
  });
};

export const userBelongsToConversation = async (userId: string, conversationId: string) => {
  const { data } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  return Boolean(data);
};

export const createMessage = async (conversationId: string, senderId: string, content: string) => {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content
    })
    .select(messageSelect)
    .single<Message>();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create message");
  }

  return data;
};

const getMessageById = async (messageId: string) => {
  const { data } = await supabase
    .from("messages")
    .select(messageSelect)
    .eq("id", messageId)
    .maybeSingle<Message>();

  return data;
};

const markConversationMessagesRead = async (conversationId: string, userId: string) => {
  const { data: messages } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .is("deleted_at", null);

  const messageIds = messages?.map((message) => message.id as string) ?? [];
  if (messageIds.length === 0) return [];

  const rows = messageIds.map((messageId) => ({
    message_id: messageId,
    user_id: userId,
    read_at: new Date().toISOString()
  }));

  await supabase.from("message_reads").upsert(rows, {
    onConflict: "message_id,user_id",
    ignoreDuplicates: true
  });

  return messageIds;
};

export default router;
