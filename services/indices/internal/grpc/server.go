// Package grpc implements the gRPC server for the NEXCOM Commodity Indices Service.
// It exposes real-time and historical commodity price indices via gRPC.
package grpc

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/nexcom/indices/internal/calculator"
	"github.com/nexcom/indices/internal/db"
	"github.com/nexcom/indices/internal/models"
	pb "github.com/nexcom/indices/proto"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// IndicesServer implements the CommodityIndicesService gRPC interface
type IndicesServer struct {
	pb.UnimplementedCommodityIndicesServiceServer
	calc       *calculator.Calculator
	indices    map[string]models.CommodityIndex
	priceCache map[string]models.CommodityPrice
	tsdb       *db.TimescaleDB // nil when running in demo mode
}

// NewIndicesServer creates a new gRPC server instance (demo mode, no DB)
func NewIndicesServer() *IndicesServer {
	return NewIndicesServerWithDB(nil)
}

// NewIndicesServerWithDB creates a gRPC server with optional TimescaleDB backing.
// When tsdb is nil the server falls back to in-memory demo data.
func NewIndicesServerWithDB(tsdb *db.TimescaleDB) *IndicesServer {
	s := &IndicesServer{
		calc:       calculator.NewCalculator(),
		indices:    make(map[string]models.CommodityIndex),
		priceCache: make(map[string]models.CommodityPrice),
		tsdb:       tsdb,
	}

	// Load predefined indices
	for _, idx := range models.PredefinedIndices {
		s.indices[idx.ID] = idx
	}

	// Initialize demo price cache
	s.initDemoPrices()

	return s
}

// initDemoPrices initializes the price cache with realistic demo data
func (s *IndicesServer) initDemoPrices() {
	demoPrices := map[string]models.CommodityPrice{
		"MAIZE":     {Symbol: "MAIZE", Name: "White Maize", Price: 285000, Bid: 284500, Ask: 285500, High: 287000, Low: 276000, Open: 278500, Close: 282000, Volume: 1250, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"SOYBEAN":   {Symbol: "SOYBEAN", Name: "Soybean", Price: 520000, Bid: 519500, Ask: 520500, High: 528000, Low: 518000, Open: 526000, Close: 524000, Volume: 980, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"SORGHUM":   {Symbol: "SORGHUM", Name: "Sorghum", Price: 195000, Bid: 194500, Ask: 195500, High: 197000, Low: 192000, Open: 196000, Close: 194000, Volume: 890, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"COCOA":     {Symbol: "COCOA", Name: "Cocoa Beans", Price: 4850000, Bid: 4845000, Ask: 4855000, High: 4870000, Low: 4650000, Open: 4670000, Close: 4720000, Volume: 125, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Premium"},
		"SESAME":    {Symbol: "SESAME", Name: "Sesame Seeds", Price: 1250000, Bid: 1248000, Ask: 1252000, High: 1260000, Low: 1240000, Open: 1239000, Close: 1245000, Volume: 210, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"CASHEW":    {Symbol: "CASHEW", Name: "Cashew Nuts", Price: 3200000, Bid: 3195000, Ask: 3205000, High: 3220000, Low: 3150000, Open: 3150000, Close: 3180000, Volume: 89, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade W320"},
		"COTTON":    {Symbol: "COTTON", Name: "Cotton Lint", Price: 1850000, Bid: 1848000, Ask: 1852000, High: 1890000, Low: 1820000, Open: 1892000, Close: 1870000, Volume: 156, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"GROUNDNUT": {Symbol: "GROUNDNUT", Name: "Groundnut", Price: 680000, Bid: 679000, Ask: 681000, High: 690000, Low: 670000, Open: 667000, Close: 675000, Volume: 430, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"RICE":      {Symbol: "RICE", Name: "Paddy Rice", Price: 380000, Bid: 379000, Ask: 381000, High: 387000, Low: 373000, Open: 387000, Close: 383000, Volume: 670, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"WHEAT":     {Symbol: "WHEAT", Name: "Wheat", Price: 420000, Bid: 419000, Ask: 421000, High: 425000, Low: 415000, Open: 415000, Close: 418000, Volume: 340, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"MILLET":    {Symbol: "MILLET", Name: "Pearl Millet", Price: 165000, Bid: 164500, Ask: 165500, High: 167000, Low: 163000, Open: 163700, Close: 164500, Volume: 520, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"SUNFLOWER": {Symbol: "SUNFLOWER", Name: "Sunflower Seed", Price: 490000, Bid: 489000, Ask: 491000, High: 495000, Low: 488000, Open: 491500, Close: 490000, Volume: 180, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"COFFEE":    {Symbol: "COFFEE", Name: "Arabica Coffee", Price: 5200000, Bid: 5195000, Ask: 5205000, High: 5250000, Low: 5100000, Open: 4990000, Close: 5050000, Volume: 67, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
		"GINGER":    {Symbol: "GINGER", Name: "Dried Ginger", Price: 2100000, Bid: 2098000, Ask: 2102000, High: 2120000, Low: 2080000, Open: 2060000, Close: 2080000, Volume: 94, Currency: "NGN", Unit: "MT", Exchange: "NEXCOM SPOT", QualityGrade: "Grade A"},
	}

	now := time.Now()
	for sym, p := range demoPrices {
		p.Timestamp = now
		p.Change = p.Price - p.Close
		if p.Close > 0 {
			p.ChangePercent = (p.Change / p.Close) * 100
		}
		s.priceCache[sym] = p
	}

	// Set base prices for calculator
	for sym, p := range demoPrices {
		s.calc.SetBasePrice(sym, p.Close)
	}
}

// GetIndex returns the current value of a named index
func (s *IndicesServer) GetIndex(ctx context.Context, req *pb.GetIndexRequest) (*pb.GetIndexResponse, error) {
	if req.IndexId == "" {
		return nil, status.Error(codes.InvalidArgument, "index_id is required")
	}

	idx, ok := s.indices[req.IndexId]
	if !ok {
		return nil, status.Errorf(codes.NotFound, "index %s not found", req.IndexId)
	}

	// Build current prices map
	currentPrices := s.getCurrentPrices()

	// Calculate index value
	value, err := s.calc.Calculate(idx, currentPrices)
	if err != nil {
		log.Error().Err(err).Str("index", req.IndexId).Msg("Failed to calculate index")
		return nil, status.Errorf(codes.Internal, "calculation failed: %v", err)
	}

	// Calculate OHLC (using base value as previous close for demo)
	previousClose := idx.BaseValue
	change, changePercent := calculator.CalculateChange(value, previousClose)

	pbIndex := &pb.Index{
		Id:            idx.ID,
		Name:          idx.Name,
		Description:   idx.Description,
		Value:         value,
		Change:        change,
		ChangePercent: changePercent,
		High:          value * 1.015,
		Low:           value * 0.985,
		Open:          previousClose,
		Timestamp:     time.Now().UnixMilli(),
		Currency:      idx.Currency,
		BaseDate:      idx.BaseDate.Format("2006-01-02"),
		BaseValue:     idx.BaseValue,
		Methodology:   string(idx.Methodology),
	}

	for _, comp := range idx.Components {
		pbIndex.Components = append(pbIndex.Components, comp.Symbol)
	}

	return &pb.GetIndexResponse{Index: pbIndex}, nil
}

// GetAllIndices returns all active indices
func (s *IndicesServer) GetAllIndices(ctx context.Context, req *pb.GetAllIndicesRequest) (*pb.GetAllIndicesResponse, error) {
	currentPrices := s.getCurrentPrices()
	var pbIndices []*pb.Index

	for _, idx := range s.indices {
		if !idx.IsActive {
			continue
		}

		// Apply category filter if specified
		if req.Category != "" && string(idx.Category) != req.Category {
			continue
		}

		value, err := s.calc.Calculate(idx, currentPrices)
		if err != nil {
			log.Warn().Err(err).Str("index", idx.ID).Msg("Skipping index due to calculation error")
			continue
		}

		change, changePercent := calculator.CalculateChange(value, idx.BaseValue)

		pbIdx := &pb.Index{
			Id:            idx.ID,
			Name:          idx.Name,
			Description:   idx.Description,
			Value:         value,
			Change:        change,
			ChangePercent: changePercent,
			High:          value * 1.015,
			Low:           value * 0.985,
			Open:          idx.BaseValue,
			Timestamp:     time.Now().UnixMilli(),
			Currency:      idx.Currency,
			BaseValue:     idx.BaseValue,
			Methodology:   string(idx.Methodology),
		}

		for _, comp := range idx.Components {
			pbIdx.Components = append(pbIdx.Components, comp.Symbol)
		}

		pbIndices = append(pbIndices, pbIdx)
	}

	return &pb.GetAllIndicesResponse{
		Indices:   pbIndices,
		Timestamp: time.Now().UnixMilli(),
	}, nil
}

// GetIndexHistory returns historical values for an index
func (s *IndicesServer) GetIndexHistory(ctx context.Context, req *pb.GetIndexHistoryRequest) (*pb.GetIndexHistoryResponse, error) {
	if req.IndexId == "" {
		return nil, status.Error(codes.InvalidArgument, "index_id is required")
	}

	idx, ok := s.indices[req.IndexId]
	if !ok {
		return nil, status.Errorf(codes.NotFound, "index %s not found", req.IndexId)
	}

	limit := int(req.Limit)
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	// Use TimescaleDB when available, fall back to synthetic data
	if s.tsdb != nil {
		from := time.Unix(req.FromTimestamp/1000, 0)
		to := time.Unix(req.ToTimestamp/1000, 0)
		if req.FromTimestamp == 0 {
			from = time.Now().Add(-30 * 24 * time.Hour)
		}
		if req.ToTimestamp == 0 {
			to = time.Now()
		}

		points, err := s.tsdb.GetIndexHistory(ctx, req.IndexId, req.Timeframe, from, to, limit)
		if err != nil {
			log.Warn().Err(err).Str("index", req.IndexId).Msg("TimescaleDB query failed, using synthetic data")
		} else if len(points) > 0 {
			pbPoints := make([]*pb.HistoricalDataPoint, len(points))
			for i, p := range points {
				pbPoints[i] = &pb.HistoricalDataPoint{
					Timestamp: p.Timestamp.UnixMilli(),
					Open:      p.Open,
					High:      p.High,
					Low:       p.Low,
					Close:     p.Close,
					Volume:    p.Volume,
				}
			}
			return &pb.GetIndexHistoryResponse{IndexId: req.IndexId, Data: pbPoints}, nil
		}
	}

	// Fallback: generate synthetic historical data
	dataPoints := s.generateHistoricalData(idx, req.Timeframe, limit)
	return &pb.GetIndexHistoryResponse{
		IndexId: req.IndexId,
		Data:    dataPoints,
	}, nil
}

// StreamIndex streams live index updates to the client
func (s *IndicesServer) StreamIndex(req *pb.StreamIndexRequest, stream pb.CommodityIndicesService_StreamIndexServer) error {
	if len(req.IndexIds) == 0 {
		return status.Error(codes.InvalidArgument, "at least one index_id is required")
	}

	interval := time.Duration(req.IntervalSeconds) * time.Second
	if interval < time.Second {
		interval = time.Second
	}
	if interval > 60*time.Second {
		interval = 60 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case <-ticker.C:
			currentPrices := s.getCurrentPrices()

			for _, indexID := range req.IndexIds {
				idx, ok := s.indices[indexID]
				if !ok {
					continue
				}

				value, err := s.calc.Calculate(idx, currentPrices)
				if err != nil {
					continue
				}

				change, changePercent := calculator.CalculateChange(value, idx.BaseValue)

				update := &pb.IndexUpdate{
					IndexId:       indexID,
					Value:         value,
					Change:        change,
					ChangePercent: changePercent,
					Timestamp:     time.Now().UnixMilli(),
				}

				if err := stream.Send(update); err != nil {
					return err
				}
			}
		}
	}
}

// GetCommodityPrice returns the current price for a commodity
func (s *IndicesServer) GetCommodityPrice(ctx context.Context, req *pb.GetCommodityPriceRequest) (*pb.GetCommodityPriceResponse, error) {
	if req.Symbol == "" {
		return nil, status.Error(codes.InvalidArgument, "symbol is required")
	}

	// Use TimescaleDB when available
	if s.tsdb != nil {
		p, err := s.tsdb.GetLatestPrice(ctx, req.Symbol)
		if err == nil {
			high, low, open, vol, _ := s.tsdb.GetMarketStats(ctx, req.Symbol)
			return &pb.GetCommodityPriceResponse{
				Price: &pb.CommodityPrice{
					Symbol:        p.Symbol,
					Name:          p.Name,
					Price:         p.Price,
					Bid:           p.Bid,
					Ask:           p.Ask,
					High:          high,
					Low:           low,
					Open:          open,
					Close:         p.Close,
					Change:        p.Change,
					ChangePercent: p.ChangePercent,
					Volume:        vol,
					Timestamp:     p.Timestamp.UnixMilli(),
					Currency:      p.Currency,
					Unit:          p.Unit,
					Exchange:      p.Exchange,
					QualityGrade:  p.QualityGrade,
				},
			}, nil
		}
		log.Warn().Err(err).Str("symbol", req.Symbol).Msg("TimescaleDB price lookup failed, using cache")
	}

	price, ok := s.priceCache[req.Symbol]
	if !ok {
		return nil, status.Errorf(codes.NotFound, "commodity %s not found", req.Symbol)
	}

	// Apply slight price movement for demo
	currentPrice := calculator.GenerateDemoPrice(price.Price, 0.002, int64(len(req.Symbol)))

	return &pb.GetCommodityPriceResponse{
		Price: &pb.CommodityPrice{
			Symbol:        price.Symbol,
			Name:          price.Name,
			Price:         currentPrice,
			Bid:           currentPrice - 500,
			Ask:           currentPrice + 500,
			High:          price.High,
			Low:           price.Low,
			Open:          price.Open,
			Close:         price.Close,
			Change:        currentPrice - price.Close,
			ChangePercent: ((currentPrice - price.Close) / price.Close) * 100,
			Volume:        price.Volume,
			Timestamp:     time.Now().UnixMilli(),
			Currency:      price.Currency,
			Unit:          price.Unit,
			Exchange:      price.Exchange,
			QualityGrade:  price.QualityGrade,
		},
	}, nil
}

// GetMarketSummary returns a market summary for all commodities
func (s *IndicesServer) GetMarketSummary(ctx context.Context, req *pb.GetMarketSummaryRequest) (*pb.GetMarketSummaryResponse, error) {
	var items []*pb.MarketSummaryItem
	gainers, losers, unchanged := 0, 0, 0

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 50
	}

	count := 0
	for _, price := range s.priceCache {
		if count >= limit {
			break
		}

		currentPrice := calculator.GenerateDemoPrice(price.Price, 0.002, int64(len(price.Symbol)))
		changePercent := ((currentPrice - price.Close) / price.Close) * 100

		trend := "FLAT"
		if changePercent > 0.1 {
			trend = "UP"
			gainers++
		} else if changePercent < -0.1 {
			trend = "DOWN"
			losers++
		} else {
			unchanged++
		}

		items = append(items, &pb.MarketSummaryItem{
			Symbol:        price.Symbol,
			Name:          price.Name,
			Price:         currentPrice,
			ChangePercent: changePercent,
			Volume:        price.Volume,
			Trend:         trend,
		})
		count++
	}

	return &pb.GetMarketSummaryResponse{
		Items:     items,
		Gainers:   int32(gainers),
		Losers:    int32(losers),
		Unchanged: int32(unchanged),
		Timestamp: time.Now().UnixMilli(),
	}, nil
}

// CalculateBasket calculates a custom basket index
func (s *IndicesServer) CalculateBasket(ctx context.Context, req *pb.CalculateBasketRequest) (*pb.CalculateBasketResponse, error) {
	if len(req.Components) == 0 {
		return nil, status.Error(codes.InvalidArgument, "at least one component is required")
	}

	// Validate weights sum to approximately 1.0
	var totalWeight float64
	for _, comp := range req.Components {
		totalWeight += comp.Weight
	}
	if math.Abs(totalWeight-1.0) > 0.01 {
		return nil, status.Errorf(codes.InvalidArgument,
			"component weights must sum to 1.0, got %.4f", totalWeight)
	}

	// Build custom index
	customIndex := models.CommodityIndex{
		ID:          fmt.Sprintf("CUSTOM_%d", time.Now().UnixMilli()),
		Name:        req.Name,
		Methodology: models.MethodologyEqualWeighted,
		Currency:    req.Currency,
		BaseValue:   1000,
	}

	for _, comp := range req.Components {
		if price, ok := s.priceCache[comp.Symbol]; ok {
			customIndex.Components = append(customIndex.Components, models.IndexComponent{
				Symbol:    comp.Symbol,
				Name:      price.Name,
				Weight:    comp.Weight,
				BasePrice: price.Close,
			})
		}
	}

	currentPrices := s.getCurrentPrices()
	value, err := s.calc.Calculate(customIndex, currentPrices)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "basket calculation failed: %v", err)
	}

	_, changePercent := calculator.CalculateChange(value, customIndex.BaseValue)

	return &pb.CalculateBasketResponse{
		Name:          req.Name,
		Value:         value,
		ChangePercent: changePercent,
		Components:    req.Components,
		Timestamp:     time.Now().UnixMilli(),
	}, nil
}

// getCurrentPrices returns the current price map for all commodities
func (s *IndicesServer) getCurrentPrices() map[string]float64 {
	prices := make(map[string]float64)
	for sym, p := range s.priceCache {
		prices[sym] = calculator.GenerateDemoPrice(p.Price, 0.002, int64(len(sym)))
	}
	return prices
}

// generateHistoricalData generates synthetic OHLCV data for demo purposes
func (s *IndicesServer) generateHistoricalData(idx models.CommodityIndex, timeframe string, limit int) []*pb.HistoricalDataPoint {
	now := time.Now()
	var intervalDur time.Duration

	switch timeframe {
	case "1H":
		intervalDur = time.Hour
	case "4H":
		intervalDur = 4 * time.Hour
	case "1D":
		intervalDur = 24 * time.Hour
	case "1W":
		intervalDur = 7 * 24 * time.Hour
	case "1M":
		intervalDur = 30 * 24 * time.Hour
	default:
		intervalDur = 24 * time.Hour
	}

	points := make([]*pb.HistoricalDataPoint, limit)
	baseValue := idx.BaseValue * 1.2 // Start slightly above base

	for i := limit - 1; i >= 0; i-- {
		t := now.Add(-time.Duration(i) * intervalDur)
		// Simulate random walk
		noise := math.Sin(float64(t.UnixMilli())*0.0001) * baseValue * 0.02
		closeVal := baseValue + noise + float64(limit-i)*0.1

		points[limit-1-i] = &pb.HistoricalDataPoint{
			Timestamp: t.UnixMilli(),
			Open:      closeVal * 0.998,
			High:      closeVal * 1.012,
			Low:       closeVal * 0.988,
			Close:     closeVal,
			Volume:    float64(1000 + (i * 50)),
		}
	}

	return points
}
