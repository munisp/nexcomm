// Package mapping defines OpenSearch index mappings for all NEXCOM entities.
// Each index mirrors a PostgreSQL table and is optimised for full-text search,
// faceted filtering, and range queries used by the platform search API.
package mapping

// IndexName constants — must match the names used in sync and query code.
const (
	IndexOrders        = "nexcom-orders"
	IndexUsers         = "nexcom-users"
	IndexInstruments   = "nexcom-instruments"
	IndexKycQueue      = "nexcom-kyc-queue"
	IndexAmlFlags      = "nexcom-aml-flags"
	IndexWarehouses    = "nexcom-warehouses"
	IndexReceipts      = "nexcom-receipts"
	IndexNotifications = "nexcom-notifications"
	IndexAuditLog      = "nexcom-audit-log"
)

// All returns a map of index name → mapping JSON body.
func All() map[string]string {
	return map[string]string{
		IndexOrders:        ordersMapping,
		IndexUsers:         usersMapping,
		IndexInstruments:   instrumentsMapping,
		IndexKycQueue:      kycQueueMapping,
		IndexAmlFlags:      amlFlagsMapping,
		IndexWarehouses:    warehousesMapping,
		IndexReceipts:      receiptsMapping,
		IndexNotifications: notificationsMapping,
		IndexAuditLog:      auditLogMapping,
	}
}

const ordersMapping = `{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "analysis": {
      "analyzer": {
        "nexcom_text": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "stop"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "id":            { "type": "integer" },
      "user_id":       { "type": "integer" },
      "symbol":        { "type": "keyword" },
      "side":          { "type": "keyword" },
      "type":          { "type": "keyword" },
      "status":        { "type": "keyword" },
      "quantity":      { "type": "double" },
      "price":         { "type": "double" },
      "filled_qty":    { "type": "double" },
      "asset_class":   { "type": "keyword" },
      "created_at":    { "type": "date" },
      "updated_at":    { "type": "date" }
    }
  }
}`

const usersMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id":           { "type": "integer" },
      "open_id":      { "type": "keyword" },
      "name":         { "type": "text", "analyzer": "nexcom_text", "fields": { "keyword": { "type": "keyword" } } },
      "email":        { "type": "keyword" },
      "role":         { "type": "keyword" },
      "status":       { "type": "keyword" },
      "kyc_status":   { "type": "keyword" },
      "account_type": { "type": "keyword" },
      "created_at":   { "type": "date" }
    }
  }
}`

const instrumentsMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "symbol":       { "type": "keyword" },
      "name":         { "type": "text", "analyzer": "nexcom_text", "fields": { "keyword": { "type": "keyword" } } },
      "asset_class":  { "type": "keyword" },
      "category":     { "type": "keyword" },
      "currency":     { "type": "keyword" },
      "is_active":    { "type": "boolean" },
      "description":  { "type": "text", "analyzer": "nexcom_text" }
    }
  }
}`

const kycQueueMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id":           { "type": "integer" },
      "user_id":      { "type": "integer" },
      "full_name":    { "type": "text", "analyzer": "nexcom_text", "fields": { "keyword": { "type": "keyword" } } },
      "email":        { "type": "keyword" },
      "account_type": { "type": "keyword" },
      "status":       { "type": "keyword" },
      "reviewer_id":  { "type": "integer" },
      "submitted_at": { "type": "date" },
      "reviewed_at":  { "type": "date" }
    }
  }
}`

const amlFlagsMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id":           { "type": "integer" },
      "user_id":      { "type": "integer" },
      "rule_id":      { "type": "integer" },
      "severity":     { "type": "keyword" },
      "status":       { "type": "keyword" },
      "description":  { "type": "text", "analyzer": "nexcom_text" },
      "amount":       { "type": "double" },
      "currency":     { "type": "keyword" },
      "flagged_at":   { "type": "date" },
      "reviewed_at":  { "type": "date" }
    }
  }
}`

const warehousesMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id":           { "type": "integer" },
      "name":         { "type": "text", "analyzer": "nexcom_text", "fields": { "keyword": { "type": "keyword" } } },
      "location":     { "type": "text", "analyzer": "nexcom_text" },
      "state":        { "type": "keyword" },
      "country":      { "type": "keyword" },
      "capacity_mt":  { "type": "double" },
      "is_certified": { "type": "boolean" },
      "commodities":  { "type": "keyword" }
    }
  }
}`

const receiptsMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id":             { "type": "integer" },
      "receipt_number": { "type": "keyword" },
      "owner_id":       { "type": "integer" },
      "commodity":      { "type": "keyword" },
      "quantity_mt":    { "type": "double" },
      "warehouse_id":   { "type": "integer" },
      "status":         { "type": "keyword" },
      "grade":          { "type": "keyword" },
      "issued_at":      { "type": "date" },
      "expires_at":     { "type": "date" }
    }
  }
}`

const notificationsMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id":         { "type": "integer" },
      "user_id":    { "type": "integer" },
      "title":      { "type": "text", "analyzer": "nexcom_text" },
      "message":    { "type": "text", "analyzer": "nexcom_text" },
      "type":       { "type": "keyword" },
      "read":       { "type": "boolean" },
      "created_at": { "type": "date" }
    }
  }
}`

const auditLogMapping = `{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id":          { "type": "integer" },
      "user_id":     { "type": "integer" },
      "action":      { "type": "keyword" },
      "entity_type": { "type": "keyword" },
      "entity_id":   { "type": "keyword" },
      "details":     { "type": "text", "analyzer": "nexcom_text" },
      "ip_address":  { "type": "ip" },
      "created_at":  { "type": "date" }
    }
  }
}`
