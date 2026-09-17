package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode"

	"gorm.io/gorm"
	"lobehub/admin/model"
)

// JSON rows preserve nullable fields and decimal strings without copying LobeHub's
// evolving business schema into GORM models. No business table is auto-migrated.
func jsonRows(db *gorm.DB, query string, args ...any) ([]json.RawMessage, error) {
	rows, err := db.Raw(query, args...).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []json.RawMessage{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		result = append(result, json.RawMessage(raw))
	}
	return result, rows.Err()
}
func jsonOne(db *gorm.DB, query string, args ...any) (json.RawMessage, error) {
	rows, err := jsonRows(db, query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return rows[0], nil
}
func pattern(value string) string {
	return "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(value) + "%"
}

type ConversationFilter struct{ Search, Type, Status, Trigger, Model, Provider, From, To, Sort, Order string }

const conversationFrom = ` FROM topics t JOIN users u ON u.id=t.user_id LEFT JOIN agents a ON a.id=t.agent_id LEFT JOIN chat_groups g ON g.id=t.group_id `
const conversationColumns = `t.id,t.title,t.status,t.trigger,t.mode,t.model,t.provider,t.total_tokens,t.total_cost::text AS total_cost,t.created_at,t.updated_at,t.user_id,t.workspace_id,
CASE WHEN t.group_id IS NOT NULL THEN 'group' WHEN t.agent_id IS NOT NULL THEN 'agent' ELSE 'unknown' END AS type,
jsonb_build_object('id',u.id,'email',u.email,'username',u.username,'full_name',u.full_name) AS owner,
COALESCE(g.title,a.title,a.name) AS source_name,
(SELECT count(*) FROM messages m WHERE m.topic_id=t.id AND COALESCE(m.is_deleted,false)=false) AS message_count`

func (s *Service) Conversations(ctx context.Context, f ConversationFilter, page, size int) (model.Page[json.RawMessage], error) {
	result := model.Page[json.RawMessage]{Items: []json.RawMessage{}, Page: page, PageSize: size}
	where := " WHERE COALESCE(t.is_deleted,false)=false"
	args := []any{}
	if f.Search != "" {
		where += " AND (t.id = ? OR t.title ILIKE ? OR u.id = ? OR u.email ILIKE ? OR u.username ILIKE ? OR u.full_name ILIKE ? OR a.id = ? OR a.title ILIKE ? OR a.name ILIKE ? OR g.id = ? OR g.title ILIKE ?)"
		p := pattern(f.Search)
		args = append(args, f.Search, p, f.Search, p, p, p, f.Search, p, p, f.Search, p)
	}
	for _, field := range []struct{ column, value string }{{"t.status", f.Status}, {"t.trigger", f.Trigger}, {"t.model", f.Model}, {"t.provider", f.Provider}} {
		if field.value != "" {
			where += " AND " + field.column + " = ?"
			args = append(args, field.value)
		}
	}
	if f.Type != "" {
		if f.Type != "agent" && f.Type != "group" && f.Type != "unknown" {
			return result, ErrInvalid
		}
		where += " AND CASE WHEN t.group_id IS NOT NULL THEN 'group' WHEN t.agent_id IS NOT NULL THEN 'agent' ELSE 'unknown' END = ?"
		args = append(args, f.Type)
	}
	for _, field := range []struct{ op, value string }{{">=", f.From}, {"<", f.To}} {
		if field.value != "" {
			parsed, err := time.Parse(time.RFC3339, field.value)
			if err != nil {
				return result, ErrInvalid
			}
			where += " AND t.updated_at " + field.op + " ?"
			args = append(args, parsed)
		}
	}
	sort := map[string]string{"updated_at": "updated_at", "created_at": "created_at", "message_count": "message_count", "total_tokens": "total_tokens", "total_cost": "total_cost::numeric"}[f.Sort]
	if sort == "" {
		sort = "updated_at"
	}
	order := "DESC"
	if f.Order == "asc" {
		order = "ASC"
	}
	db := s.DB.WithContext(ctx)
	if err := db.Raw("SELECT count(*)"+conversationFrom+where, args...).Scan(&result.Total).Error; err != nil {
		return result, err
	}
	query := "SELECT to_jsonb(row) FROM (SELECT " + conversationColumns + conversationFrom + where + ") row ORDER BY " + sort + " " + order + " NULLS LAST,id ASC LIMIT ? OFFSET ?"
	items, err := jsonRows(db, query, append(args, size, (page-1)*size)...)
	result.Items = items
	return result, err
}

type MessageCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}
type MessagePage struct {
	Conversation json.RawMessage   `json:"conversation"`
	Items        []json.RawMessage `json:"items"`
	NextCursor   string            `json:"nextCursor"`
	HasMore      bool              `json:"hasMore"`
}

func (s *Service) Messages(ctx context.Context, actor, id, cursor string) (MessagePage, error) {
	result := MessagePage{Items: []json.RawMessage{}}
	db := s.DB.WithContext(ctx)
	conversation, err := jsonOne(db, "SELECT to_jsonb(row) FROM (SELECT "+conversationColumns+conversationFrom+" WHERE t.id = ? AND COALESCE(t.is_deleted,false)=false) row", id)
	if err != nil {
		return result, err
	}
	result.Conversation = conversation
	where := "m.topic_id = ? AND COALESCE(m.is_deleted,false)=false"
	args := []any{id}
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		var c MessageCursor
		if err != nil || len(raw) > 1024 || json.Unmarshal(raw, &c) != nil || c.ID == "" || c.CreatedAt.IsZero() {
			return result, ErrInvalid
		}
		where += " AND (m.created_at,m.id) < (?,?)"
		args = append(args, c.CreatedAt, c.ID)
	}
	query := `SELECT to_jsonb(m) || jsonb_build_object(
'actor_name',a.title,'plugin',to_jsonb(p),'translation',to_jsonb(tr),'tts',to_jsonb(tt),
'thread',to_jsonb(th),'message_group',to_jsonb(mg),
'queries',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'user_query',q.user_query,'rewrite_query',q.rewrite_query)) FROM message_queries q WHERE q.message_id=m.id),'[]'::jsonb),
'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'file_type',f.file_type,'size',f.size,'url',f.url)) FROM messages_files mf JOIN files f ON f.id=mf.file_id WHERE mf.message_id=m.id),'[]'::jsonb))
FROM (SELECT * FROM messages m WHERE ` + where + ` ORDER BY m.created_at DESC,m.id DESC LIMIT 26) m
LEFT JOIN agents a ON a.id=m.agent_id LEFT JOIN message_plugins p ON p.id=m.id LEFT JOIN message_translates tr ON tr.id=m.id LEFT JOIN message_tts tt ON tt.id=m.id LEFT JOIN threads th ON th.id=m.thread_id LEFT JOIN message_groups mg ON mg.id=m.message_group_id
ORDER BY m.created_at DESC,m.id DESC`
	items, err := jsonRows(db, query, args...)
	if err != nil {
		return result, err
	}
	if len(items) > 25 {
		result.HasMore = true
		items = items[:25]
	}
	if result.HasMore {
		var last struct {
			ID        string    `json:"id"`
			CreatedAt time.Time `json:"created_at"`
		}
		if err := json.Unmarshal(items[len(items)-1], &last); err != nil {
			return result, err
		}
		raw, _ := json.Marshal(MessageCursor{ID: last.ID, CreatedAt: last.CreatedAt})
		result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	for i := len(items) - 1; i >= 0; i-- {
		result.Items = append(result.Items, items[i])
	}
	if err := audit(db, actor, "conversation.read", id); err != nil {
		return result, err
	}
	return result, nil
}

type KnowledgeFilter struct{ Search, Scope, Workspace, Visibility, RAGStatus, Sort, Order string }

// Current LobeHub uses document_chunks, not the older file_chunks relation.
// Separate aggregates prevent file sizes from being multiplied by document/chunk joins.
const knowledgeCTE = `WITH kb_files AS (
 SELECT kf.knowledge_base_id,f.id,f.size,f.chunk_task_id,f.embedding_task_id,ct.status AS chunk_status,et.status AS embedding_status
 FROM knowledge_base_files kf JOIN files f ON f.id=kf.file_id LEFT JOIN async_tasks ct ON ct.id=f.chunk_task_id LEFT JOIN async_tasks et ON et.id=f.embedding_task_id
), kb_documents AS (
 SELECT d.knowledge_base_id,d.id FROM documents d WHERE d.knowledge_base_id IS NOT NULL AND COALESCE(d.is_deleted,false)=false
 UNION SELECT kf.knowledge_base_id,d.id FROM kb_files kf JOIN documents d ON d.file_id=kf.id WHERE COALESCE(d.is_deleted,false)=false
), kb_chunks AS (
 SELECT DISTINCT kd.knowledge_base_id,dc.chunk_id FROM kb_documents kd JOIN document_chunks dc ON dc.document_id=kd.id
), file_stats AS (
 SELECT knowledge_base_id,count(*) AS file_count,COALESCE(sum(size),0) AS total_size,
 bool_or(chunk_status='error' OR embedding_status='error') AS has_error,
 bool_or(chunk_status IN ('pending','processing') OR embedding_status IN ('pending','processing')) AS processing,
 bool_and(COALESCE(chunk_status='success',false) AND COALESCE(embedding_status='success',false)) AS complete
 FROM kb_files GROUP BY knowledge_base_id
), chunk_stats AS (
 SELECT kc.knowledge_base_id,count(*) AS chunk_count,count(e.id) FILTER (WHERE e.embeddings IS NOT NULL) AS embedded_chunk_count FROM kb_chunks kc LEFT JOIN embeddings e ON e.chunk_id=kc.chunk_id GROUP BY kc.knowledge_base_id
), document_stats AS (SELECT knowledge_base_id,count(*) AS document_count FROM kb_documents GROUP BY knowledge_base_id), libraries AS (
 SELECT k.id,k.name,k.description,k.avatar,k.type,k.user_id,k.workspace_id,k.visibility,k.is_public,k.created_at,k.updated_at,
 jsonb_build_object('id',u.id,'email',u.email,'username',u.username,'full_name',u.full_name) AS owner,
 CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug) END AS workspace,
 COALESCE(fs.file_count,0) AS file_count,COALESCE(fs.total_size,0) AS total_size,COALESCE(ds.document_count,0) AS document_count,COALESCE(cs.chunk_count,0) AS chunk_count,COALESCE(cs.embedded_chunk_count,0) AS embedded_chunk_count,
 CASE WHEN fs.has_error THEN 'error' WHEN fs.processing THEN 'processing' WHEN COALESCE(fs.file_count,0)=0 AND COALESCE(ds.document_count,0)=0 THEN 'empty' WHEN COALESCE(fs.complete,true) AND cs.chunk_count>0 AND cs.chunk_count=cs.embedded_chunk_count THEN 'ready' ELSE 'unindexed' END AS rag_status
 FROM knowledge_bases k JOIN users u ON u.id=k.user_id LEFT JOIN workspaces w ON w.id=k.workspace_id LEFT JOIN file_stats fs ON fs.knowledge_base_id=k.id LEFT JOIN chunk_stats cs ON cs.knowledge_base_id=k.id LEFT JOIN document_stats ds ON ds.knowledge_base_id=k.id WHERE COALESCE(k.is_deleted,false)=false
) `

func (s *Service) KnowledgeBases(ctx context.Context, f KnowledgeFilter, page, size int) (model.Page[json.RawMessage], error) {
	result := model.Page[json.RawMessage]{Items: []json.RawMessage{}, Page: page, PageSize: size}
	where := " WHERE true"
	args := []any{}
	if f.Search != "" {
		where += " AND (id = ? OR name ILIKE ? OR owner->>'email' ILIKE ? OR owner->>'username' ILIKE ? OR owner->>'full_name' ILIKE ? OR user_id = ? OR workspace->>'name' ILIKE ? OR workspace_id = ?)"
		p := pattern(f.Search)
		args = append(args, f.Search, p, p, p, p, f.Search, p, f.Search)
	}
	if f.Scope == "personal" {
		where += " AND workspace_id IS NULL"
	} else if f.Scope == "workspace" {
		where += " AND workspace_id IS NOT NULL"
	} else if f.Scope != "" {
		return result, ErrInvalid
	}
	for _, field := range []struct{ column, value string }{{"workspace_id", f.Workspace}, {"visibility", f.Visibility}, {"rag_status", f.RAGStatus}} {
		if field.value != "" {
			where += " AND " + field.column + " = ?"
			args = append(args, field.value)
		}
	}
	sort := map[string]string{"updated_at": "updated_at", "created_at": "created_at", "file_count": "file_count", "total_size": "total_size"}[f.Sort]
	if sort == "" {
		sort = "updated_at"
	}
	order := "DESC"
	if f.Order == "asc" {
		order = "ASC"
	}
	db := s.DB.WithContext(ctx)
	if err := db.Raw(knowledgeCTE+"SELECT count(*) FROM libraries"+where, args...).Scan(&result.Total).Error; err != nil {
		return result, err
	}
	items, err := jsonRows(db, knowledgeCTE+"SELECT to_jsonb(libraries) FROM libraries"+where+" ORDER BY "+sort+" "+order+",id ASC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	result.Items = items
	return result, err
}

func (s *Service) KnowledgeBase(ctx context.Context, id string) (json.RawMessage, error) {
	return jsonOne(s.DB.WithContext(ctx), knowledgeCTE+"SELECT to_jsonb(libraries) FROM libraries WHERE id = ?", id)
}

type KnowledgeUpdate struct {
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Avatar      string    `json:"avatar"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (s *Service) UpdateKnowledge(ctx context.Context, actor, id string, input KnowledgeUpdate) error {
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.Avatar = strings.TrimSpace(input.Avatar)
	if input.Name == "" || len(input.Name) > 255 || len(input.Description) > 4096 || len(input.Avatar) > 2048 || input.UpdatedAt.IsZero() || strings.IndexFunc(input.Name, unicode.IsControl) >= 0 {
		return ErrInvalid
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		r := tx.Exec("UPDATE knowledge_bases SET name = ?,description = NULLIF(?,''),avatar = NULLIF(?,''),updated_at = now() WHERE id = ? AND updated_at = ? AND COALESCE(is_deleted,false)=false", input.Name, input.Description, input.Avatar, id, input.UpdatedAt)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected == 0 {
			return ErrConflict
		}
		return audit(tx, actor, "knowledge.update", id)
	})
}

func (s *Service) KnowledgeFiles(ctx context.Context, id string, page, size int) (model.Page[json.RawMessage], error) {
	result := model.Page[json.RawMessage]{Items: []json.RawMessage{}, Page: page, PageSize: size}
	db := s.DB.WithContext(ctx)
	if _, err := s.KnowledgeBase(ctx, id); err != nil {
		return result, err
	}
	if err := db.Raw("SELECT count(*) FROM knowledge_base_files WHERE knowledge_base_id = ?", id).Scan(&result.Total).Error; err != nil {
		return result, err
	}
	query := `SELECT jsonb_build_object('id',f.id,'name',f.name,'file_type',f.file_type,'size',f.size,'url',f.url,'created_at',f.created_at,'chunking_status',ct.status,'chunking_error',ct.error,'embedding_status',et.status,'embedding_error',et.error,
'document_count',(SELECT count(*) FROM documents d WHERE d.file_id=f.id AND COALESCE(d.is_deleted,false)=false),
'chunk_count',(SELECT count(DISTINCT dc.chunk_id) FROM documents d JOIN document_chunks dc ON dc.document_id=d.id WHERE d.file_id=f.id AND COALESCE(d.is_deleted,false)=false),
'embedded_chunk_count',(SELECT count(DISTINCT dc.chunk_id) FROM documents d JOIN document_chunks dc ON dc.document_id=d.id JOIN embeddings e ON e.chunk_id=dc.chunk_id AND e.embeddings IS NOT NULL WHERE d.file_id=f.id AND COALESCE(d.is_deleted,false)=false))
FROM knowledge_base_files kf JOIN files f ON f.id=kf.file_id LEFT JOIN async_tasks ct ON ct.id=f.chunk_task_id LEFT JOIN async_tasks et ON et.id=f.embedding_task_id WHERE kf.knowledge_base_id = ? ORDER BY f.created_at DESC,f.id LIMIT ? OFFSET ?`
	items, err := jsonRows(db, query, id, size, (page-1)*size)
	result.Items = items
	return result, err
}

const documentMembership = `(d.knowledge_base_id = ? OR EXISTS (SELECT 1 FROM knowledge_base_files kf WHERE kf.knowledge_base_id = ? AND kf.file_id=d.file_id)) AND COALESCE(d.is_deleted,false)=false`

func (s *Service) KnowledgeDocuments(ctx context.Context, id string, page, size int) (model.Page[json.RawMessage], error) {
	result := model.Page[json.RawMessage]{Items: []json.RawMessage{}, Page: page, PageSize: size}
	db := s.DB.WithContext(ctx)
	if _, err := s.KnowledgeBase(ctx, id); err != nil {
		return result, err
	}
	if err := db.Raw("SELECT count(*) FROM documents d WHERE "+documentMembership, id, id).Scan(&result.Total).Error; err != nil {
		return result, err
	}
	items, err := jsonRows(db, "SELECT to_jsonb(row) FROM (SELECT d.id,d.title,d.file_type,d.filename,d.file_id,d.total_char_count,d.total_line_count,d.created_at,d.updated_at FROM documents d WHERE "+documentMembership+" ORDER BY d.updated_at DESC,d.id LIMIT ? OFFSET ?) row", id, id, size, (page-1)*size)
	result.Items = items
	return result, err
}
func (s *Service) KnowledgeDocument(ctx context.Context, actor, id, documentID string) (json.RawMessage, error) {
	if _, err := s.KnowledgeBase(ctx, id); err != nil {
		return nil, err
	}
	db := s.DB.WithContext(ctx)
	item, err := jsonOne(db, "SELECT to_jsonb(d) FROM documents d WHERE d.id = ? AND "+documentMembership, documentID, id, id)
	if err != nil {
		return nil, err
	}
	if err := audit(db, actor, "knowledge.document.read", id+"/"+documentID); err != nil {
		return nil, err
	}
	return item, nil
}
func (s *Service) KnowledgeChunks(ctx context.Context, actor, id, fileID string, page, size int) (model.Page[json.RawMessage], error) {
	result := model.Page[json.RawMessage]{Items: []json.RawMessage{}, Page: page, PageSize: size}
	db := s.DB.WithContext(ctx)
	if _, err := s.KnowledgeBase(ctx, id); err != nil {
		return result, err
	}
	var count int64
	if err := db.Table("knowledge_base_files").Where("knowledge_base_id = ? AND file_id = ?", id, fileID).Count(&count).Error; err != nil {
		return result, err
	}
	if count == 0 {
		return result, gorm.ErrRecordNotFound
	}
	from := ` FROM chunks c WHERE c.id IN (SELECT dc.chunk_id FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE d.file_id = ? AND COALESCE(d.is_deleted,false)=false)`
	if err := db.Raw("SELECT count(*)"+from, fileID).Scan(&result.Total).Error; err != nil {
		return result, err
	}
	items, err := jsonRows(db, `SELECT to_jsonb(c) || jsonb_build_object('has_embedding',EXISTS (SELECT 1 FROM embeddings e WHERE e.chunk_id=c.id AND e.embeddings IS NOT NULL),'model',(SELECT e.model FROM embeddings e WHERE e.chunk_id=c.id))`+from+` ORDER BY c.index NULLS LAST,c.id LIMIT ? OFFSET ?`, fileID, size, (page-1)*size)
	result.Items = items
	if err == nil {
		err = audit(db, actor, "knowledge.chunks.read", fmt.Sprintf("%s/%s", id, fileID))
	}
	return result, err
}
