package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

const contentFixture = `
CREATE TABLE users (id text PRIMARY KEY,email text,username text,full_name text);
CREATE TABLE agents (id text PRIMARY KEY,title text,name text);
CREATE TABLE chat_groups (id text PRIMARY KEY,title text);
CREATE TABLE topics (id text PRIMARY KEY,title text,status text,trigger text,mode text,model text,provider text,total_tokens int,total_cost numeric,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),user_id text,workspace_id text,agent_id text,group_id text,is_deleted bool);
CREATE TABLE messages (id text PRIMARY KEY,topic_id text,agent_id text,thread_id text,message_group_id text,role text,content text,created_at timestamptz DEFAULT now(),is_deleted bool);
CREATE TABLE message_plugins (id text PRIMARY KEY);
CREATE TABLE message_translates (id text PRIMARY KEY);
CREATE TABLE message_tts (id text PRIMARY KEY);
CREATE TABLE threads (id text PRIMARY KEY);
CREATE TABLE message_groups (id text PRIMARY KEY);
CREATE TABLE message_queries (id text PRIMARY KEY,message_id text,user_query text,rewrite_query text);
CREATE TABLE messages_files (message_id text,file_id text);
CREATE TABLE files (id text PRIMARY KEY,name text,file_type text,size bigint,url text,chunk_task_id text,embedding_task_id text,created_at timestamptz DEFAULT now());
CREATE TABLE workspaces (id text PRIMARY KEY,name text,slug text);
CREATE TABLE knowledge_bases (id text PRIMARY KEY,name text,description text,avatar text,type text,user_id text,workspace_id text,visibility text,is_public bool,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),is_deleted bool);
CREATE TABLE knowledge_base_files (knowledge_base_id text,file_id text,PRIMARY KEY(knowledge_base_id,file_id));
CREATE TABLE async_tasks (id text PRIMARY KEY,status text,error jsonb);
CREATE TABLE documents (id text PRIMARY KEY,knowledge_base_id text,file_id text,title text,filename text,file_type text,total_char_count int,total_line_count int,content text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),is_deleted bool);
CREATE TABLE document_chunks (document_id text,chunk_id text,PRIMARY KEY(document_id,chunk_id));
CREATE TABLE chunks (id text PRIMARY KEY,index int,text text,abstract text,metadata jsonb);
CREATE TABLE embeddings (id text PRIMARY KEY,chunk_id text UNIQUE,model text,embeddings text);
INSERT INTO users VALUES ('u1','reader@example.com','reader','Reader');
INSERT INTO agents VALUES ('agent1','Research assistant','research');
INSERT INTO topics (id,title,user_id,agent_id,model,provider,total_tokens,total_cost) VALUES ('topic1','Research notes','u1','agent1','test-model','openai',300,0.123456);
INSERT INTO knowledge_bases (id,name,user_id,visibility) VALUES ('kb1','Research library','u1','private'),('kb2','Other library','u1','private');
INSERT INTO async_tasks VALUES ('task1','success',null),('task2','success',null);
INSERT INTO files (id,name,file_type,size,url,chunk_task_id,embedding_task_id) VALUES ('f1','guide.md','text/markdown',100,'https://example.com/guide.md','task1','task2'),('f2','private.md','text/markdown',200,'https://example.com/private.md',null,null);
INSERT INTO knowledge_base_files VALUES ('kb1','f1'),('kb2','f2');
INSERT INTO documents (id,knowledge_base_id,file_id,title,file_type,total_char_count,total_line_count,content) VALUES ('d1','kb1','f1','Guide','text/markdown',25,1,'A searchable guide.'),('d2',null,'f1','Appendix','text/markdown',20,1,'An attached appendix.'),('d3','kb2','f2','Private','text/markdown',15,1,'Another library.');
INSERT INTO chunks VALUES ('c1',0,'Guide chunk',null,null),('c2',1,'Appendix chunk',null,null);
INSERT INTO document_chunks VALUES ('d1','c1'),('d2','c2');
INSERT INTO embeddings VALUES ('e1','c1','test-embedding','private-vector'),('e2','c2','test-embedding','private-vector');
`

func seedContent(t *testing.T, s *Service) {
	t.Helper()
	if err := s.DB.Exec(contentFixture).Error; err != nil {
		t.Fatal(err)
	}
}

func TestConversationCursorAndFilters(t *testing.T) {
	s := testService(t)
	seedContent(t, s)
	ctx := context.Background()
	stamp := time.Now().UTC().Truncate(time.Second)
	for i := 0; i < 31; i++ {
		if err := s.DB.Exec("INSERT INTO messages(id,topic_id,role,content,created_at) VALUES (?, 'topic1','user',?,?)", fmt.Sprintf("m%03d", i), fmt.Sprintf("Message %d", i), stamp).Error; err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.Conversations(ctx, ConversationFilter{Search: "Research", Sort: "total_cost"}, 1, 25)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || !strings.Contains(string(page.Items[0]), `"total_cost": "0.123456"`) {
		t.Fatal("search/cost mismatch", string(page.Items[0]))
	}
	first, err := s.Messages(ctx, "operator", "topic1", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 25 || !first.HasMore {
		t.Fatal("first page wrong")
	}
	second, err := s.Messages(ctx, "operator", "topic1", first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 6 || second.HasMore {
		t.Fatal("second page wrong")
	}
	seen := map[string]bool{}
	for _, raw := range append(second.Items, first.Items...) {
		var row struct{ ID string }
		json.Unmarshal(raw, &row)
		if seen[row.ID] {
			t.Fatal("duplicate message")
		}
		seen[row.ID] = true
	}
	if len(seen) != 31 {
		t.Fatal("messages lost")
	}
	if _, err := s.Messages(ctx, "operator", "topic1", "invalid"); !errors.Is(err, ErrInvalid) {
		t.Fatal("invalid cursor accepted")
	}
	page, err = s.Conversations(ctx, ConversationFilter{Search: "%"}, 1, 25)
	if err != nil || page.Total != 0 {
		t.Fatal("wildcard not escaped", err)
	}
}

func TestKnowledgeStatsMembershipAndOptimisticEdit(t *testing.T) {
	s := testService(t)
	seedContent(t, s)
	ctx := context.Background()
	page, err := s.KnowledgeBases(ctx, KnowledgeFilter{Search: "Research"}, 1, 25)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatal("wrong total")
	}
	var kb struct {
		FileCount     int       `json:"file_count"`
		DocumentCount int       `json:"document_count"`
		ChunkCount    int       `json:"chunk_count"`
		Embedded      int       `json:"embedded_chunk_count"`
		Size          int       `json:"total_size"`
		Status        string    `json:"rag_status"`
		UpdatedAt     time.Time `json:"updated_at"`
	}
	if err := json.Unmarshal(page.Items[0], &kb); err != nil {
		t.Fatal(err)
	}
	if kb.FileCount != 1 || kb.DocumentCount != 2 || kb.ChunkCount != 2 || kb.Embedded != 2 || kb.Size != 100 || kb.Status != "ready" {
		t.Fatalf("aggregates multiplied or indirect document lost: %+v", kb)
	}
	overflow, err := s.KnowledgeBases(ctx, KnowledgeFilter{}, 100, 25)
	if err != nil || overflow.Total != 2 || len(overflow.Items) != 0 {
		t.Fatal("out of range page lost total")
	}
	files, err := s.KnowledgeFiles(ctx, "kb1", 1, 25)
	if err != nil || files.Total != 1 {
		t.Fatal("file list failed", err)
	}
	docs, err := s.KnowledgeDocuments(ctx, "kb1", 1, 25)
	if err != nil || docs.Total != 2 {
		t.Fatal("document list failed", err)
	}
	if _, err := s.KnowledgeDocument(ctx, "operator", "kb1", "d2"); err != nil {
		t.Fatal("indirect document inaccessible", err)
	}
	if _, err := s.KnowledgeDocument(ctx, "operator", "kb1", "d3"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("cross-library document leaked", err)
	}
	if _, err := s.KnowledgeChunks(ctx, "operator", "kb1", "f2", 1, 25); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("cross-library file leaked", err)
	}
	chunks, err := s.KnowledgeChunks(ctx, "operator", "kb1", "f1", 1, 25)
	if err != nil || chunks.Total != 2 {
		t.Fatal("chunks missing", err)
	}
	raw, _ := json.Marshal(chunks)
	if strings.Contains(string(raw), "private-vector") {
		t.Fatal("embedding values leaked")
	}
	update := KnowledgeUpdate{Name: "Updated library", Description: "New description", UpdatedAt: kb.UpdatedAt}
	if err := s.UpdateKnowledge(ctx, "operator", "kb1", update); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateKnowledge(ctx, "operator", "kb1", update); !errors.Is(err, ErrConflict) {
		t.Fatal("stale update accepted", err)
	}
	if err := s.DB.Exec("UPDATE async_tasks SET status='error' WHERE id='task1'").Error; err != nil {
		t.Fatal(err)
	}
	page, err = s.KnowledgeBases(ctx, KnowledgeFilter{RAGStatus: "error"}, 1, 25)
	if err != nil || page.Total != 1 {
		t.Fatal("failed tasks hidden by complete vectors", err)
	}
}

func TestContentListPageBoundaries(t *testing.T) {
	s := testService(t)
	seedContent(t, s)
	ctx := context.Background()
	// Shared timestamps exercise the ID tie-breaker on every paginated list.
	err := s.DB.Exec(`
INSERT INTO topics(id,title,user_id,created_at,updated_at) SELECT 'page-topic-'||n,'Boundary','u1','2026-01-01','2026-01-01' FROM generate_series(1,30) n;
INSERT INTO files(id,name,size,created_at) SELECT 'page-file-'||n,'Boundary',1,'2026-01-01' FROM generate_series(1,30) n;
INSERT INTO knowledge_base_files SELECT 'kb1','page-file-'||n FROM generate_series(1,30) n;
INSERT INTO documents(id,file_id,title,created_at,updated_at) SELECT 'page-document-'||n,'f1','Boundary','2026-01-01','2026-01-01' FROM generate_series(1,30) n;
INSERT INTO chunks(id,index,text) SELECT 'page-chunk-'||n,1,'Boundary' FROM generate_series(1,30) n;
INSERT INTO document_chunks SELECT 'd1','page-chunk-'||n FROM generate_series(1,30) n;
`).Error
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"conversations", "files", "documents", "chunks"} {
		t.Run(kind, func(t *testing.T) {
			seen := map[string]bool{}
			var total int64
			for page := 1; page <= 2; page++ {
				var items []json.RawMessage
				switch kind {
				case "conversations":
					r, e := s.Conversations(ctx, ConversationFilter{}, page, 25)
					items, total, err = r.Items, r.Total, e
				case "files":
					r, e := s.KnowledgeFiles(ctx, "kb1", page, 25)
					items, total, err = r.Items, r.Total, e
				case "documents":
					r, e := s.KnowledgeDocuments(ctx, "kb1", page, 25)
					items, total, err = r.Items, r.Total, e
				case "chunks":
					r, e := s.KnowledgeChunks(ctx, "operator", "kb1", "f1", page, 25)
					items, total, err = r.Items, r.Total, e
				}
				if err != nil {
					t.Fatal(err)
				}
				if page == 1 && len(items) != 25 {
					t.Fatalf("first page size: %d", len(items))
				}
				for _, item := range items {
					var row struct{ ID string }
					if err := json.Unmarshal(item, &row); err != nil {
						t.Fatal(err)
					}
					if seen[row.ID] {
						t.Fatalf("duplicate across pages: %s", row.ID)
					}
					seen[row.ID] = true
				}
			}
			if int64(len(seen)) != total || total < 31 {
				t.Fatalf("missing rows: got %d of %d", len(seen), total)
			}
		})
	}
}
