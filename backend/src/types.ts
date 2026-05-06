export type User = {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  name: string;
  is_group: boolean;
  created_by: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  users?: Pick<User, "id" | "name" | "avatar_url">;
  message_reads?: Array<{
    user_id: string;
    read_at: string;
    users?: Pick<User, "id" | "name" | "avatar_url">;
  }>;
};

export type AuthToken = {
  sub: string;
  email: string;
  name: string;
};
