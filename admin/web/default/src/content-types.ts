export interface Owner {
  email: string | null;
  full_name: string | null;
  id: string;
  username: string | null;
}
export interface Conversation {
  created_at: string;
  id: string;
  message_count: number;
  model: string | null;
  owner: Owner;
  provider: string | null;
  source_name: string | null;
  status: string | null;
  title: string | null;
  total_cost: string | null;
  total_tokens: number | null;
  trigger: string | null;
  type: string;
  updated_at: string;
}
export interface ConversationMessage {
  actor_name: string | null;
  attachments: { id: string; name: string; url: string; size: number; file_type: string }[];
  content: string | null;
  created_at: string;
  editor_data: unknown;
  error: unknown;
  id: string;
  message_group: unknown;
  metadata: unknown;
  model: string | null;
  plugin: unknown;
  provider: string | null;
  queries: unknown;
  reasoning: unknown;
  role: string;
  search: unknown;
  thread: unknown;
  tools: unknown;
  translation: unknown;
  tts: unknown;
  usage: unknown;
}
export interface MessagePage {
  conversation: Conversation;
  hasMore: boolean;
  items: ConversationMessage[];
  nextCursor: string;
}
export interface KnowledgeBase {
  avatar: string | null;
  chunk_count: number;
  description: string | null;
  document_count: number;
  embedded_chunk_count: number;
  file_count: number;
  id: string;
  name: string;
  owner: Owner;
  rag_status: string;
  total_size: number;
  updated_at: string;
  visibility: string;
  workspace: { id: string; name: string; slug: string } | null;
}
export interface KnowledgeFile {
  chunk_count: number;
  chunking_error: unknown;
  chunking_status: string | null;
  document_count: number;
  embedded_chunk_count: number;
  embedding_error: unknown;
  embedding_status: string | null;
  file_type: string;
  id: string;
  name: string;
  size: number;
  url: string;
}
export interface KnowledgeDocument {
  content?: string;
  editor_data?: unknown;
  file_type: string;
  filename: string | null;
  id: string;
  metadata?: unknown;
  pages?: unknown;
  title: string | null;
  total_char_count: number;
  updated_at: string;
}
export interface Chunk {
  abstract: string | null;
  has_embedding: boolean;
  id: string;
  index: number | null;
  metadata: unknown;
  model: string | null;
  text: string | null;
}
