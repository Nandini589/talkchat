"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Check,
  CheckCheck,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wifi
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { createSocket } from "@/lib/socket";
import type { Conversation, Message, User } from "@/lib/types";

type TypingUser = { id: string; name: string };

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [roomMembers, setRoomMembers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [roomName, setRoomName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectedAddMemberIds, setSelectedAddMemberIds] = useState<string[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(new Map());
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);
  const activeConversationRef = useRef("");
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = conversations.find((item) => item.id === activeConversationId);
  const roomMemberIds = useMemo(
    () => new Set(roomMembers.map((member) => member.id)),
    [roomMembers]
  );
  const availablePeopleToAdd = useMemo(
    () => people.filter((person) => !roomMemberIds.has(person.id)),
    [people, roomMemberIds]
  );

  const activeTypingNames = useMemo(
    () =>
      Array.from(typingUsers.values())
        .filter((typingUser) => typingUser.id !== user?.id)
        .map((typingUser) => typingUser.name),
    [typingUsers, user?.id]
  );

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    const boot = async () => {
      try {
        const [{ user: currentUser }, { conversations: rooms }, { users }] = await Promise.all([
          api.me(),
          api.conversations(),
          api.users()
        ]);

        setUser(currentUser);
        setConversations(rooms);
        setPeople(users);
        setOnlineUsers(new Set([currentUser.id]));
        setActiveConversationId(rooms[0]?.id ?? "");
      } catch {
        router.replace("/login");
      } finally {
        setIsLoading(false);
      }
    };

    boot();
  }, [router]);

  useEffect(() => {
    if (!user) return;

    const socket = createSocket();
    socketRef.current = socket;

    socket.on("message:new", ({ message }: { message: Message }) => {
      if (message.conversation_id !== activeConversationRef.current) return;
      setMessages((current) =>
        current.some((existing) => existing.id === message.id) ? current : [...current, message]
      );
    });

    socket.on("message:updated", ({ message }: { message: Message }) => {
      if (message.conversation_id !== activeConversationRef.current) return;
      setMessages((current) =>
        current.map((existing) => (existing.id === message.id ? message : existing))
      );
    });

    socket.on("message:deleted", ({ message }: { message: Message }) => {
      if (message.conversation_id !== activeConversationRef.current) return;
      setMessages((current) =>
        current.map((existing) => (existing.id === message.id ? message : existing))
      );
    });

    socket.on(
      "message:read",
      ({
        conversationId,
        messageIds,
        reader,
        readAt
      }: {
        conversationId: string;
        messageIds: string[];
        reader: Pick<User, "id" | "name" | "avatar_url">;
        readAt: string;
      }) => {
        if (conversationId !== activeConversationRef.current) return;
        setMessages((current) =>
          current.map((message) => {
            if (!messageIds.includes(message.id)) return message;
            const existingReads = message.message_reads ?? [];
            if (existingReads.some((read) => read.user_id === reader.id)) return message;

            return {
              ...message,
              message_reads: [
                ...existingReads,
                {
                  user_id: reader.id,
                  read_at: readAt,
                  users: reader
                }
              ]
            };
          })
        );
      }
    );

    socket.on("conversation:new", ({ conversation }: { conversation: Conversation }) => {
      setConversations((current) =>
        current.some((existing) => existing.id === conversation.id)
          ? current
          : [conversation, ...current]
      );
    });

    socket.on(
      "conversation:members-added",
      async ({ conversationId }: { conversationId: string }) => {
        if (conversationId !== activeConversationRef.current) return;
        const { members } = await api.members(conversationId);
        setRoomMembers(members);
      }
    );

    socket.on("presence:online", ({ userId }: { userId: string }) => {
      setOnlineUsers((current) => new Set(current).add(userId));
    });

    socket.on("presence:offline", ({ userId }: { userId: string }) => {
      setOnlineUsers((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    });

    socket.on(
      "typing:start",
      ({ conversationId, user: typingUser }: { conversationId: string; user: TypingUser }) => {
        if (conversationId !== activeConversationRef.current) return;
        setTypingUsers((current) => new Map(current).set(typingUser.id, typingUser));
      }
    );

    socket.on("typing:stop", ({ userId }: { userId: string }) => {
      setTypingUsers((current) => {
        const next = new Map(current);
        next.delete(userId);
        return next;
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    if (!activeConversationId) return;

    const loadMessages = async () => {
      try {
        const [{ messages: nextMessages }, { members }] = await Promise.all([
          api.messages(activeConversationId),
          api.members(activeConversationId)
        ]);
        setMessages(nextMessages);
        setRoomMembers(members);
        socketRef.current?.emit("conversation:join", activeConversationId);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load messages");
      }
    };

    setTypingUsers(new Map());
    setSelectedAddMemberIds([]);
    loadMessages();
  }, [activeConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const content = messageText.trim();
    if (!content || !activeConversationId) return;

    socketRef.current?.emit(
      "message:send",
      { conversationId: activeConversationId, content },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) {
          setError(response.error ?? "Message failed");
        }
      }
    );

    socketRef.current?.emit("typing:stop", activeConversationId);
    setMessageText("");
  };

  const handleTyping = (value: string) => {
    setMessageText(value);
    if (!activeConversationId) return;

    socketRef.current?.emit("typing:start", activeConversationId);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("typing:stop", activeConversationId);
    }, 900);
  };

  const createRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!roomName.trim()) return;

    try {
      const { conversation } = await api.createConversation(roomName.trim(), selectedMemberIds);
      setConversations((current) => [conversation, ...current]);
      setActiveConversationId(conversation.id);
      setRoomName("");
      setSelectedMemberIds([]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create room");
    }
  };

  const addMembersToActiveRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeConversationId || selectedAddMemberIds.length === 0) return;

    try {
      await api.addMembers(activeConversationId, selectedAddMemberIds);
      const { members } = await api.members(activeConversationId);
      setRoomMembers(members);
      setSelectedAddMemberIds([]);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add members");
    }
  };

  const editMessage = async (messageId: string, content: string) => {
    try {
      const { message } = await api.editMessage(messageId, content);
      setMessages((current) =>
        current.map((existing) => (existing.id === message.id ? message : existing))
      );
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Could not edit message");
    }
  };

  const deleteMessage = async (messageId: string) => {
    try {
      const { message } = await api.deleteMessage(messageId);
      setMessages((current) =>
        current.map((existing) => (existing.id === message.id ? message : existing))
      );
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete message");
    }
  };

  const logout = async () => {
    await api.logout().catch(() => null);
    router.replace("/login");
  };

  if (isLoading) {
    return (
      <main className="loading-shell">
        <div className="loading-orb" />
        <p>Preparing your campus chat...</p>
      </main>
    );
  }

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-lockup">
            <span className="brand-icon">
              <MessageCircle size={22} />
            </span>
            <div>
              <p className="eyebrow">Campus Chat</p>
              <h1>Workspace</h1>
            </div>
          </div>
          <button className="icon-button" onClick={logout} aria-label="Log out">
            <LogOut size={18} />
          </button>
        </div>

        <section className="profile-card">
          <Avatar user={user} />
          <div>
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
        </section>

        <form className="room-form" onSubmit={createRoom}>
          <label htmlFor="room-name">New channel</label>
          <div className="input-row">
            <input
              id="room-name"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="e.g. Final year project"
            />
            <button type="submit" aria-label="Create room">
              <Plus size={18} />
            </button>
          </div>
          <MemberDropdown
            label="Members"
            users={people}
            selectedIds={selectedMemberIds}
            emptyText="Classmates appear here after they sign in."
            onToggle={(personId) =>
              setSelectedMemberIds((current) =>
                current.includes(personId)
                  ? current.filter((id) => id !== personId)
                  : [...current, personId]
              )
            }
          />
        </form>

        <div className="section-title">
          <Users size={16} />
          Rooms
        </div>
        <nav className="conversation-list">
          {conversations.map((conversation) => (
            <button
              className={
                conversation.id === activeConversationId
                  ? "conversation-item conversation-active"
                  : "conversation-item"
              }
              key={conversation.id}
              onClick={() => setActiveConversationId(conversation.id)}
            >
              <span>{conversation.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{conversation.name}</strong>
                <small>{conversation.is_group ? "Channel" : "Direct message"}</small>
              </div>
            </button>
          ))}
        </nav>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Active channel</p>
            <h2>{activeConversation?.name ?? "No room selected"}</h2>
          </div>
          <div className="header-actions">
            <span className="status-pill">
              <Wifi size={16} />
              Realtime
            </span>
            <span className="status-pill muted">
              <ShieldCheck size={16} />
              Server-managed data
            </span>
          </div>
        </header>

        <form className="member-panel" onSubmit={addMembersToActiveRoom}>
          <div>
            <p className="eyebrow">Manage access</p>
            <h3>Add classmates to this channel</h3>
          </div>
          <div className="member-panel-actions">
            <MemberDropdown
              label="Add members"
              users={availablePeopleToAdd}
              selectedIds={selectedAddMemberIds}
              emptyText="All signed-in classmates are already members."
              onToggle={(personId) =>
                setSelectedAddMemberIds((current) =>
                  current.includes(personId)
                    ? current.filter((id) => id !== personId)
                    : [...current, personId]
                )
              }
            />
            <button
              className="secondary-action"
              type="submit"
              disabled={!activeConversationId || selectedAddMemberIds.length === 0}
            >
              <UserPlus size={17} />
              Add
            </button>
          </div>
        </form>

        {error ? (
          <button className="error-banner inline" onClick={() => setError("")}>
            {error}
          </button>
        ) : null}

        <div className="message-list">
          {messages.length === 0 ? (
            <div className="empty-state">
              <Search size={38} />
              <h3>No messages yet</h3>
              <p>Start with a project update, announcement, or question for this channel.</p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isMine={message.sender_id === user?.id}
                onDelete={deleteMessage}
                onEdit={editMessage}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="typing-line">
          {activeTypingNames.length > 0 ? `${activeTypingNames.join(", ")} typing...` : " "}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            value={messageText}
            onChange={(event) => handleTyping(event.target.value)}
            placeholder="Write a message..."
            aria-label="Message"
          />
          <button type="submit" disabled={!messageText.trim() || !activeConversationId}>
            <Send size={18} />
            Send
          </button>
        </form>
      </section>

      <aside className="right-rail">
        <div className="rail-card">
          <p className="eyebrow">Channel members</p>
          <h3>{roomMembers.length} members</h3>
          <div className="people-list">
            {roomMembers.map((person) => (
              <div className="person-row" key={person.id}>
                <Avatar user={person} compact />
                <div>
                  <strong>{person.name}</strong>
                  <span>{onlineUsers.has(person.id) ? "Online" : "Offline"}</span>
                </div>
                <i className={onlineUsers.has(person.id) ? "dot online" : "dot"} />
              </div>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}

function Avatar({ user, compact = false }: { user: User | null; compact?: boolean }) {
  const initials = user?.name
    ?.split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (user?.avatar_url) {
    return (
      <img
        className={compact ? "avatar avatar-compact" : "avatar"}
        src={user.avatar_url}
        alt={`${user.name} avatar`}
      />
    );
  }

  return <span className={compact ? "avatar avatar-compact" : "avatar"}>{initials ?? "CC"}</span>;
}

function MemberDropdown({
  label,
  users,
  selectedIds,
  emptyText,
  onToggle
}: {
  label: string;
  users: User[];
  selectedIds: string[];
  emptyText: string;
  onToggle: (personId: string) => void;
}) {
  return (
    <details className="member-dropdown">
      <summary>
        <span>
          {label}
          <strong>
            {selectedIds.length === 0
              ? "No members selected"
              : `${selectedIds.length} selected`}
          </strong>
        </span>
        <ChevronDown size={16} />
      </summary>
      <div className="member-dropdown-list" aria-label={label}>
        {users.length === 0 ? (
          <span className="helper-text">{emptyText}</span>
        ) : (
          users.map((person) => (
            <button
              type="button"
              className={
                selectedIds.includes(person.id)
                  ? "member-option member-option-active"
                  : "member-option"
              }
              key={person.id}
              onClick={() => onToggle(person.id)}
            >
              <Avatar user={person} compact />
              <span>{person.name}</span>
              <i>{selectedIds.includes(person.id) ? "Selected" : "Add"}</i>
            </button>
          ))
        )}
      </div>
    </details>
  );
}

function MessageBubble({
  message,
  isMine,
  onDelete,
  onEdit
}: {
  message: Message;
  isMine: boolean;
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const sentAt = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(message.created_at));
  const reads = message.message_reads ?? [];
  const seenBy = reads
    .map((read) => read.users?.name)
    .filter((name): name is string => Boolean(name));
  const isDeleted = Boolean(message.deleted_at);

  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    const nextContent = draft.trim();
    if (!nextContent || nextContent === message.content) {
      setIsEditing(false);
      setDraft(message.content);
      return;
    }
    onEdit(message.id, nextContent);
    setIsEditing(false);
  };

  return (
    <article className={isMine ? "message-row mine" : "message-row"}>
      {!isMine ? <Avatar user={(message.users as User) ?? null} compact /> : null}
      <div className="message-bubble">
        <div className="message-meta">
          <strong>
            {isMine ? "You" : message.users?.name ?? "Classmate"}
            {message.edited_at && !isDeleted ? <em>edited</em> : null}
          </strong>
          <span>
            {sentAt}
            {isMine ? (
              <span className="read-tick" title={seenBy.length ? `Seen by ${seenBy.join(", ")}` : "Sent"}>
                {seenBy.length > 0 ? <CheckCheck size={14} /> : <Check size={14} />}
              </span>
            ) : null}
          </span>
        </div>
        {isEditing ? (
          <form className="edit-message-form" onSubmit={saveEdit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Edit message"
              autoFocus
            />
            <button type="submit">Save</button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setDraft(message.content);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <p className={isDeleted ? "deleted-message" : undefined}>
            {isDeleted ? "This message was deleted" : message.content}
          </p>
        )}
        <div className="message-footer">
          {isMine && seenBy.length > 0 ? <span>Seen by {seenBy.join(", ")}</span> : <span />}
          {isMine && !isDeleted && !isEditing ? (
            <div className="message-actions">
              <button type="button" onClick={() => setIsEditing(true)} aria-label="Edit message">
                <Pencil size={13} />
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete this message?")) onDelete(message.id);
                }}
                aria-label="Delete message"
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
