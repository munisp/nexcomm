package api

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/munisp/NGApp/services/gateway/internal/models"
)

// ============================================================
// WebSocket Infrastructure (Gap 2 - Real WS upgrade)
// ============================================================

// wsUpgrade performs a raw WebSocket handshake via HTTP hijacker (no external deps)
func wsUpgrade(w http.ResponseWriter, r *http.Request) (net.Conn, error) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, fmt.Errorf("server doesn't support hijacking")
	}
	wsKey := r.Header.Get("Sec-WebSocket-Key")
	if wsKey == "" {
		return nil, fmt.Errorf("missing Sec-WebSocket-Key")
	}
	h := sha1.New()
	h.Write([]byte(wsKey + "258EAFA5-E914-47DA-95CA-5AB5B86F11D5"))
	acceptKey := base64.StdEncoding.EncodeToString(h.Sum(nil))

	conn, bufrw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	resp := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acceptKey + "\r\n\r\n"
	if _, err := bufrw.WriteString(resp); err != nil {
		conn.Close()
		return nil, err
	}
	bufrw.Flush()
	return conn, nil
}

// wsWriteText writes a WebSocket text frame
func wsWriteText(conn net.Conn, data []byte) error {
	frame := make([]byte, 0, 10+len(data))
	frame = append(frame, 0x81) // FIN + text opcode
	if len(data) < 126 {
		frame = append(frame, byte(len(data)))
	} else if len(data) < 65536 {
		frame = append(frame, 126, byte(len(data)>>8), byte(len(data)&0xff))
	} else {
		frame = append(frame, 127)
		for i := 7; i >= 0; i-- {
			frame = append(frame, byte(len(data)>>(i*8)&0xff))
		}
	}
	frame = append(frame, data...)
	_, err := conn.Write(frame)
	return err
}

// wsReadFrame reads one WebSocket frame (handles client masking)
func wsReadFrame(conn net.Conn) ([]byte, byte, error) {
	r := bufio.NewReader(conn)
	header := make([]byte, 2)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, 0, err
	}
	opcode := header[0] & 0x0f
	masked := header[1]&0x80 != 0
	length := int(header[1] & 0x7f)
	if length == 126 {
		ext := make([]byte, 2)
		if _, err := io.ReadFull(r, ext); err != nil {
			return nil, 0, err
		}
		length = int(ext[0])<<8 | int(ext[1])
	} else if length == 127 {
		ext := make([]byte, 8)
		if _, err := io.ReadFull(r, ext); err != nil {
			return nil, 0, err
		}
		length = 0
		for i := 0; i < 8; i++ {
			length = length<<8 | int(ext[i])
		}
	}
	var mask []byte
	if masked {
		mask = make([]byte, 4)
		if _, err := io.ReadFull(r, mask); err != nil {
			return nil, 0, err
		}
	}
	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return nil, 0, err
		}
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return payload, opcode, nil
}

// Market data hub singleton for broadcasting to all WS clients
var (
	mdClients   = make(map[net.Conn]bool)
	mdMu        sync.RWMutex
	mdTickerOnce sync.Once
)

func startMarketDataTicker() {
	mdTickerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			symbols := []string{"GOLD", "CRUDE", "COCOA", "COFFEE", "COTTON"}
			for range ticker.C {
				for _, sym := range symbols {
					msg, _ := json.Marshal(map[string]interface{}{
						"type":      "ticker",
						"symbol":    sym,
						"timestamp": time.Now().UTC().Format(time.RFC3339),
						"price":     1800.0 + float64(time.Now().UnixNano()%10000)/100,
						"volume":    1000 + time.Now().UnixNano()%5000,
					})
					mdMu.RLock()
					for conn := range mdClients {
						_ = wsWriteText(conn, msg)
					}
					mdMu.RUnlock()
				}
			}
		}()
	})
}

// proxyGet forwards a GET request to an upstream service and returns the response.
func (s *Server) proxyGet(c *gin.Context, baseURL, path string) {
	url := fmt.Sprintf("%s%s", baseURL, path)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("upstream unavailable: %v", err),
		})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		c.Data(resp.StatusCode, "application/json", body)
		return
	}
	c.JSON(resp.StatusCode, models.APIResponse{Success: true, Data: result})
}

// proxyPost forwards a POST request to an upstream service.
func (s *Server) proxyPost(c *gin.Context, baseURL, path string) {
	url := fmt.Sprintf("%s%s", baseURL, path)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("upstream unavailable: %v", err),
		})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		c.Data(resp.StatusCode, "application/json", body)
		return
	}
	c.JSON(resp.StatusCode, models.APIResponse{Success: true, Data: result})
}

// ============================================================
// Matching Engine Proxy Handlers
// ============================================================

func (s *Server) matchingEngineStatus(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/status")
}

func (s *Server) matchingEngineDepth(c *gin.Context) {
	symbol := c.Param("symbol")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/orderbook/"+symbol)
}

func (s *Server) matchingEngineSymbols(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/symbols")
}

func (s *Server) matchingEngineFutures(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/futures/contracts")
}

func (s *Server) matchingEngineOptions(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/options/contracts")
}

func (s *Server) matchingEnginePositions(c *gin.Context) {
	accountID := c.Param("account_id")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/clearing/positions/"+accountID)
}

func (s *Server) matchingEngineSurveillance(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/surveillance/alerts")
}

func (s *Server) matchingEngineWarehouses(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/delivery/warehouses")
}

func (s *Server) matchingEngineAudit(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/audit/entries")
}

// ============================================================
// Market Makers Proxy Handlers
// ============================================================

func (s *Server) meMarketMakersList(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/market-makers")
}

func (s *Server) meMarketMakersGet(c *gin.Context) {
	id := c.Param("id")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/market-makers/"+id)
}

func (s *Server) meMarketMakersPerformance(c *gin.Context) {
	id := c.Param("id")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/market-makers/"+id+"/performance")
}

func (s *Server) meMarketMakersQuotes(c *gin.Context) {
	symbol := c.Param("symbol")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/market-makers/quotes/"+symbol)
}

func (s *Server) meMarketMakersSubmitQuote(c *gin.Context) {
	s.proxyPost(c, s.cfg.MatchingEngineURL, "/api/v1/market-makers/quotes")
}

// ============================================================
// Indices Proxy Handlers
// ============================================================

func (s *Server) meIndicesList(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/indices")
}

func (s *Server) meIndicesValues(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/indices/values")
}

func (s *Server) meIndicesGet(c *gin.Context) {
	id := c.Param("id")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/indices/"+id)
}

func (s *Server) meIndicesValue(c *gin.Context) {
	id := c.Param("id")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/indices/"+id+"/value")
}

// ============================================================
// Corporate Actions Proxy Handlers
// ============================================================

func (s *Server) meCorporateActionsList(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/corporate-actions")
}

func (s *Server) meCorporateActionsPending(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/corporate-actions/pending")
}

func (s *Server) meCorporateActionsForSymbol(c *gin.Context) {
	symbol := c.Param("symbol")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/corporate-actions/"+symbol)
}

func (s *Server) meCorporateActionsProcess(c *gin.Context) {
	id := c.Param("id")
	s.proxyPost(c, s.cfg.MatchingEngineURL, "/api/v1/corporate-actions/"+id+"/process")
}

// ============================================================
// Brokers Proxy Handlers
// ============================================================

func (s *Server) meBrokersList(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/brokers")
}

func (s *Server) meBrokersGet(c *gin.Context) {
	id := c.Param("id")
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/brokers/"+id)
}

func (s *Server) meBrokersConnected(c *gin.Context) {
	s.proxyGet(c, s.cfg.MatchingEngineURL, "/api/v1/brokers/connected")
}

func (s *Server) meBrokersRoute(c *gin.Context) {
	s.proxyPost(c, s.cfg.MatchingEngineURL, "/api/v1/brokers/route")
}

// ============================================================
// Ingestion Engine Proxy Handlers
// ============================================================

func (s *Server) ingestionFeeds(c *gin.Context) {
	s.proxyGet(c, s.cfg.IngestionEngineURL, "/api/v1/feeds")
}

func (s *Server) ingestionStartFeed(c *gin.Context) {
	id := c.Param("id")
	s.proxyPost(c, s.cfg.IngestionEngineURL, "/api/v1/feeds/"+id+"/start")
}

func (s *Server) ingestionStopFeed(c *gin.Context) {
	id := c.Param("id")
	s.proxyPost(c, s.cfg.IngestionEngineURL, "/api/v1/feeds/"+id+"/stop")
}

func (s *Server) ingestionMetrics(c *gin.Context) {
	s.proxyGet(c, s.cfg.IngestionEngineURL, "/api/v1/feeds/metrics")
}

func (s *Server) ingestionLakehouseStatus(c *gin.Context) {
	s.proxyGet(c, s.cfg.IngestionEngineURL, "/api/v1/lakehouse/status")
}

func (s *Server) ingestionLakehouseCatalog(c *gin.Context) {
	s.proxyGet(c, s.cfg.IngestionEngineURL, "/api/v1/lakehouse/catalog")
}

func (s *Server) ingestionSchemaRegistry(c *gin.Context) {
	s.proxyGet(c, s.cfg.IngestionEngineURL, "/api/v1/schema-registry")
}

func (s *Server) ingestionPipelineStatus(c *gin.Context) {
	s.proxyGet(c, s.cfg.IngestionEngineURL, "/api/v1/pipeline/status")
}

func (s *Server) ingestionBackfill(c *gin.Context) {
	s.proxyPost(c, s.cfg.IngestionEngineURL, "/api/v1/pipeline/backfill")
}

func (s *Server) ingestionLakehouseQuery(c *gin.Context) {
	s.proxyPost(c, s.cfg.IngestionEngineURL, "/api/v1/lakehouse/query")
}

func (s *Server) ingestionLakehouseLineage(c *gin.Context) {
	table := c.Param("table")
	s.proxyGet(c, s.cfg.IngestionEngineURL, "/api/v1/lakehouse/lineage/"+table)
}

// ============================================================
// Platform Health Aggregator (Improvement #16)
// ============================================================

func (s *Server) platformHealth(c *gin.Context) {
	type serviceHealth struct {
		Name    string `json:"name"`
		Status  string `json:"status"`
		URL     string `json:"url"`
		Latency string `json:"latency,omitempty"`
	}

	services := []serviceHealth{
		{Name: "gateway", Status: "healthy", URL: "localhost:8000"},
		{Name: "kafka", Status: boolToStatus(s.kafka.IsConnected()), URL: s.cfg.KafkaBrokers},
		{Name: "redis", Status: boolToStatus(s.redis.IsConnected()), URL: s.cfg.RedisURL},
		{Name: "temporal", Status: boolToStatus(s.temporal.IsConnected()), URL: s.cfg.TemporalHost},
		{Name: "tigerbeetle", Status: boolToStatus(s.tigerbeetle.IsConnected()), URL: s.cfg.TigerBeetleAddresses},
		{Name: "dapr", Status: boolToStatus(s.dapr.IsConnected()), URL: "localhost:" + s.cfg.DaprHTTPPort},
		{Name: "fluvio", Status: boolToStatus(s.fluvio.IsConnected()), URL: s.cfg.FluvioEndpoint},
		{Name: "keycloak", Status: "configured", URL: s.cfg.KeycloakURL},
		{Name: "permify", Status: boolToStatus(s.permify.IsConnected()), URL: s.cfg.PermifyEndpoint},
	}

	// Check upstream services
	upstreams := []struct {
		name string
		url  string
	}{
		{"matching-engine", s.cfg.MatchingEngineURL},
		{"ingestion-engine", s.cfg.IngestionEngineURL},
	}

	client := &http.Client{Timeout: 3 * time.Second}
	for _, up := range upstreams {
		start := time.Now()
		resp, err := client.Get(up.url + "/health")
		latency := time.Since(start)
		status := "unhealthy"
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				status = "healthy"
			}
		}
		services = append(services, serviceHealth{
			Name:    up.name,
			Status:  status,
			URL:     up.url,
			Latency: latency.String(),
		})
	}

	healthy := 0
	for _, svc := range services {
		if svc.Status == "healthy" || svc.Status == "configured" {
			healthy++
		}
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data: gin.H{
			"platform":        "nexcom-exchange",
			"status":          fmt.Sprintf("%d/%d services healthy", healthy, len(services)),
			"services":        services,
			"timestamp":       time.Now().Format(time.RFC3339),
			"totalServices":   len(services),
			"healthyServices": healthy,
		},
	})
}

func boolToStatus(connected bool) string {
	if connected {
		return "healthy"
	}
	return "unhealthy"
}

// ============================================================
// Accounts CRUD (Improvement #18)
// ============================================================

func (s *Server) listAccounts(c *gin.Context) {
	accounts := s.store.GetAccounts()
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{"accounts": accounts}})
}

func (s *Server) createAccount(c *gin.Context) {
	var req models.CreateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Error: err.Error()})
		return
	}
	account := s.store.CreateAccount(req)
	c.JSON(http.StatusCreated, models.APIResponse{Success: true, Data: account})
}

func (s *Server) getAccount(c *gin.Context) {
	id := c.Param("id")
	account, ok := s.store.GetAccount(id)
	if !ok {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Error: "account not found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: account})
}

func (s *Server) updateAccount(c *gin.Context) {
	id := c.Param("id")
	var req models.UpdateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Error: err.Error()})
		return
	}
	account, ok := s.store.UpdateAccount(id, req)
	if !ok {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Error: "account not found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: account})
}

func (s *Server) deleteAccount(c *gin.Context) {
	id := c.Param("id")
	if !s.store.DeleteAccount(id) {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Error: "account not found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{"message": "account deleted"}})
}

// ============================================================
// Audit Log Read (Improvement #18)
// ============================================================

func (s *Server) listAuditLog(c *gin.Context) {
	entries := s.store.GetAuditLog()
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{"entries": entries}})
}

func (s *Server) getAuditEntry(c *gin.Context) {
	id := c.Param("id")
	entry, ok := s.store.GetAuditEntry(id)
	if !ok {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Error: "audit entry not found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: entry})
}

// ============================================================
// WebSocket Endpoints (Improvement #8)
// ============================================================

func (s *Server) wsNotifications(c *gin.Context) {
	// Check if this is a WebSocket upgrade request
	if c.GetHeader("Upgrade") != "websocket" {
		// Non-WS request: return usage info
		c.JSON(http.StatusOK, models.APIResponse{
			Success: true,
			Data: gin.H{
				"message": "WebSocket endpoint for notifications",
				"usage":   "Connect via ws://host:8000/api/v1/ws/notifications with Upgrade: websocket header",
				"events":  []string{"order_filled", "price_alert", "margin_warning", "trade_executed", "settlement_complete"},
			},
		})
		return
	}

	conn, err := wsUpgrade(c.Writer, c.Request)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Error: err.Error()})
		return
	}
	defer conn.Close()

	// Send welcome message
	welcome, _ := json.Marshal(map[string]interface{}{
		"type":    "connected",
		"channel": "notifications",
		"events":  []string{"order_filled", "price_alert", "margin_warning", "trade_executed", "settlement_complete"},
	})
	_ = wsWriteText(conn, welcome)

	// Read loop (keeps connection alive, handles pings/close)
	for {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		_, opcode, err := wsReadFrame(conn)
		if err != nil || opcode == 0x08 { // close frame
			break
		}
		// opcode 0x09 = ping -> respond with pong
		if opcode == 0x09 {
			pong := []byte{0x8A, 0x00} // pong frame with no payload
			conn.Write(pong)
		}
	}
}

func (s *Server) wsMarketData(c *gin.Context) {
	// Check if this is a WebSocket upgrade request
	if c.GetHeader("Upgrade") != "websocket" {
		c.JSON(http.StatusOK, models.APIResponse{
			Success: true,
			Data: gin.H{
				"message":  "WebSocket endpoint for market data",
				"usage":    "Connect via ws://host:8000/api/v1/ws/market-data with Upgrade: websocket header",
				"channels": []string{"ticker", "orderbook", "trades", "candles", "depth"},
			},
		})
		return
	}

	conn, err := wsUpgrade(c.Writer, c.Request)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Error: err.Error()})
		return
	}

	// Register client for market data broadcasts
	startMarketDataTicker()
	mdMu.Lock()
	mdClients[conn] = true
	mdMu.Unlock()

	// Send welcome
	welcome, _ := json.Marshal(map[string]interface{}{
		"type":     "connected",
		"channel":  "market-data",
		"channels": []string{"ticker", "orderbook", "trades", "candles", "depth"},
	})
	_ = wsWriteText(conn, welcome)

	// Read loop
	for {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		_, opcode, err := wsReadFrame(conn)
		if err != nil || opcode == 0x08 {
			break
		}
		if opcode == 0x09 {
			pong := []byte{0x8A, 0x00}
			conn.Write(pong)
		}
	}

	// Cleanup
	mdMu.Lock()
	delete(mdClients, conn)
	mdMu.Unlock()
	conn.Close()
}

// ============================================================
// Blockchain Service Proxy Handlers (Digital Assets + IPFS + Fractional Trading)
// ============================================================

// Tokenization
func (s *Server) bcTokenize(c *gin.Context) {
	s.proxyPost(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/tokenize")
}
func (s *Server) bcListTokens(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/tokens")
}
func (s *Server) bcGetToken(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/tokens/"+c.Param("token_id"))
}
func (s *Server) bcTransferToken(c *gin.Context) {
	s.proxyPost(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/tokens/"+c.Param("token_id")+"/transfer")
}
func (s *Server) bcFractionalizeToken(c *gin.Context) {
	s.proxyPost(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/tokens/"+c.Param("token_id")+"/fractionalize")
}

// Settlement (DvP)
func (s *Server) bcSettle(c *gin.Context) {
	s.proxyPost(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/settle")
}
func (s *Server) bcGetTransaction(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/tx/"+c.Param("tx_hash"))
}

// Bridge
func (s *Server) bcBridgeInitiate(c *gin.Context) {
	s.proxyPost(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/bridge/initiate")
}
func (s *Server) bcChainStatus(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/chains/status")
}

// Fractional Trading
func (s *Server) bcFractionalAssets(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/fractions/assets")
}
func (s *Server) bcFractionalAsset(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/fractions/assets/"+c.Param("asset_id"))
}
func (s *Server) bcFractionalOrder(c *gin.Context) {
	s.proxyPost(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/fractions/orders")
}
func (s *Server) bcFractionalOrderbook(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/fractions/orderbook/"+c.Param("asset_id"))
}
func (s *Server) bcFractionalTrades(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/fractions/trades")
}
func (s *Server) bcFractionalPortfolio(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/fractions/portfolio/"+c.Param("holder_id"))
}

// IPFS
func (s *Server) bcIpfsPin(c *gin.Context) {
	s.proxyPost(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/ipfs/pin")
}
func (s *Server) bcIpfsGet(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/ipfs/get/"+c.Param("cid"))
}
func (s *Server) bcIpfsStatus(c *gin.Context) {
	s.proxyGet(c, s.cfg.BlockchainServiceURL, "/api/v1/blockchain/ipfs/status")
}

// ============================================================
// KYC Service Proxy Handlers
// ============================================================

func (s *Server) kycListApplications(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/kyc/applications")
}
func (s *Server) kycCreateApplication(c *gin.Context) {
	s.proxyPost(c, s.cfg.KYCServiceURL, "/api/v1/kyc/applications")
}
func (s *Server) kycGetApplication(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/kyc/applications/"+c.Param("id"))
}
func (s *Server) kycStakeholderTypes(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/onboarding/stakeholder-types")
}
func (s *Server) kycStats(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/kyc/stats")
}

// KYB proxy handlers
func (s *Server) kybListApplications(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/kyb/applications")
}
func (s *Server) kybCreateApplication(c *gin.Context) {
	s.proxyPost(c, s.cfg.KYCServiceURL, "/api/v1/kyb/applications")
}
func (s *Server) kybGetApplication(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/kyb/applications/"+c.Param("id"))
}

// Warehouse Receipts proxy handlers (through KYC service)
func (s *Server) kycWarehouseReceipts(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/warehouse-receipts")
}
func (s *Server) kycCreateWarehouseReceipt(c *gin.Context) {
	s.proxyPost(c, s.cfg.KYCServiceURL, "/api/v1/warehouse-receipts")
}

// Produce Registration proxy handlers (through KYC service)
func (s *Server) kycProduceInventory(c *gin.Context) {
	s.proxyGet(c, s.cfg.KYCServiceURL, "/api/v1/produce/inventory")
}
func (s *Server) kycRegisterProduce(c *gin.Context) {
	s.proxyPost(c, s.cfg.KYCServiceURL, "/api/v1/produce/register")
}
