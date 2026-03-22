package api

// ============================================================
// Analytics Service Proxy Handlers
// Delegates to Python analytics service (port 8004) for:
//   - Dashboard aggregates (market cap, volume, movers)
//   - P&L reports (Flink streaming + Spark batch)
//   - Geospatial supply chain analytics (Apache Sedona)
//   - AI/ML insights (Ray HMM, anomaly detection)
//   - Price forecasting (LSTM-Attention via Ray Train)
//   - DataFusion analytical queries
//   - Report generation (PDF via Temporal workflow)
//
// AI/ML Service Proxy Handlers
// Delegates to Python AI/ML service (port 8007) for:
//   - LSTM-Attention price forecasting with Lakehouse feature store
//   - Isolation Forest + GNN anomaly detection
//   - Gradient boosting risk scoring
//   - News/social sentiment analysis
// ============================================================

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/munisp/NGApp/services/gateway/internal/models"
)

// ─── Analytics Service ───────────────────────────────────────────────────────

// analyticsDashboard proxies to the Python analytics service dashboard endpoint.
func (s *Server) analyticsDashboard(c *gin.Context) {
	query := c.Request.URL.RawQuery
	path := "/api/v1/analytics/dashboard"
	if query != "" {
		path = path + "?" + query
	}
	s.proxyGetWithAuth(c, s.cfg.AnalyticsServiceURL, path)
}

// pnlReport proxies to the Python analytics service P&L endpoint.
func (s *Server) pnlReport(c *gin.Context) {
	period := c.DefaultQuery("period", "1M")
	path := fmt.Sprintf("/api/v1/analytics/pnl?period=%s", url.QueryEscape(period))
	s.proxyGetWithAuth(c, s.cfg.AnalyticsServiceURL, path)
}

// geospatialData proxies to the Python analytics service Sedona geospatial endpoint.
func (s *Server) geospatialData(c *gin.Context) {
	commodity := c.Param("commodity")
	s.proxyGetWithAuth(c, s.cfg.AnalyticsServiceURL, "/api/v1/analytics/geospatial/"+url.PathEscape(commodity))
}

// aiInsights proxies to the Python analytics service Ray-powered AI insights endpoint.
func (s *Server) aiInsights(c *gin.Context) {
	s.proxyGetWithAuth(c, s.cfg.AnalyticsServiceURL, "/api/v1/analytics/ai-insights")
}

// priceForecast proxies to the Python analytics service LSTM forecast endpoint.
func (s *Server) priceForecast(c *gin.Context) {
	symbol := c.Param("symbol")
	horizon := c.DefaultQuery("horizon", "7")
	path := fmt.Sprintf("/api/v1/analytics/forecast/%s?horizon=%s", url.PathEscape(symbol), url.QueryEscape(horizon))
	s.proxyGetWithAuth(c, s.cfg.AnalyticsServiceURL, path)
}

// analyticsQuery proxies DataFusion SQL queries to the Python analytics service.
func (s *Server) analyticsQuery(c *gin.Context) {
	sqlQuery := c.Query("sql")
	s.proxyGetWithAuth(c, s.cfg.AnalyticsServiceURL, "/api/v1/analytics/query?sql="+url.QueryEscape(sqlQuery))
}

// analyticsReport proxies report generation to the Python analytics service.
func (s *Server) analyticsReport(c *gin.Context) {
	reportType := c.Param("report_type")
	period := c.DefaultQuery("period", "1M")
	path := fmt.Sprintf("/api/v1/analytics/reports/%s?period=%s", url.PathEscape(reportType), url.QueryEscape(period))
	s.proxyGetWithAuth(c, s.cfg.AnalyticsServiceURL, path)
}

// ─── AI/ML Service ───────────────────────────────────────────────────────────

// aimlForecast proxies to the AI/ML service LSTM forecasting endpoint.
func (s *Server) aimlForecast(c *gin.Context) {
	s.proxyPost(c, s.cfg.AiMlServiceURL, "/api/v1/ai/forecast")
}

// aimlForecastModels proxies to the AI/ML service model listing endpoint.
func (s *Server) aimlForecastModels(c *gin.Context) {
	s.proxyGet(c, s.cfg.AiMlServiceURL, "/api/v1/ai/forecast/models")
}

// aimlRiskScore proxies to the AI/ML service risk scoring endpoint.
func (s *Server) aimlRiskScore(c *gin.Context) {
	s.proxyPost(c, s.cfg.AiMlServiceURL, "/api/v1/ai/risk-score")
}

// aimlRiskScoreBatch proxies to the AI/ML service batch risk scoring endpoint.
func (s *Server) aimlRiskScoreBatch(c *gin.Context) {
	s.proxyPost(c, s.cfg.AiMlServiceURL, "/api/v1/ai/risk-score/batch")
}

// aimlAnomaliesRecent proxies to the AI/ML service recent anomalies endpoint.
func (s *Server) aimlAnomaliesRecent(c *gin.Context) {
	s.proxyGet(c, s.cfg.AiMlServiceURL, "/api/v1/ai/anomalies/recent")
}

// aimlAnomaliesSymbol proxies to the AI/ML service symbol anomalies endpoint.
func (s *Server) aimlAnomaliesSymbol(c *gin.Context) {
	symbol := c.Param("symbol")
	s.proxyGet(c, s.cfg.AiMlServiceURL, "/api/v1/ai/anomalies/symbol/"+url.PathEscape(symbol))
}

// aimlAnomaliesStats proxies to the AI/ML service anomaly stats endpoint.
func (s *Server) aimlAnomaliesStats(c *gin.Context) {
	s.proxyGet(c, s.cfg.AiMlServiceURL, "/api/v1/ai/anomalies/stats")
}

// aimlAnomaliesConfigure proxies to the AI/ML service anomaly configuration endpoint.
func (s *Server) aimlAnomaliesConfigure(c *gin.Context) {
	s.proxyPost(c, s.cfg.AiMlServiceURL, "/api/v1/ai/anomalies/configure")
}

// aimlSentiment proxies to the AI/ML service sentiment endpoint.
func (s *Server) aimlSentiment(c *gin.Context) {
	symbol := c.Param("symbol")
	s.proxyGet(c, s.cfg.AiMlServiceURL, "/api/v1/ai/sentiment/"+url.PathEscape(symbol))
}

// aimlSentimentSummary proxies to the AI/ML service sentiment summary endpoint.
func (s *Server) aimlSentimentSummary(c *gin.Context) {
	s.proxyGet(c, s.cfg.AiMlServiceURL, "/api/v1/ai/sentiment/summary/all")
}

// aimlNewsSentiment proxies to the AI/ML service news sentiment endpoint.
func (s *Server) aimlNewsSentiment(c *gin.Context) {
	symbol := c.Param("symbol")
	s.proxyGet(c, s.cfg.AiMlServiceURL, "/api/v1/ai/sentiment/news/"+url.PathEscape(symbol))
}

// ─── proxyGetWithAuth ─────────────────────────────────────────────────────────
// Forwards a GET request to an upstream service, passing the Authorization
// header from the incoming request and streaming the response body directly.
func (s *Server) proxyGetWithAuth(c *gin.Context, baseURL, path string) {
	fullURL := fmt.Sprintf("%s%s", baseURL, path)
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, fullURL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create request: %v", err),
		})
		return
	}
	if auth := c.GetHeader("Authorization"); auth != "" {
		req.Header.Set("Authorization", auth)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("upstream unavailable: %v", err),
		})
		return
	}
	defer resp.Body.Close()
	c.Header("Content-Type", "application/json")
	c.Status(resp.StatusCode)
	io.Copy(c.Writer, resp.Body)
}
