// Package streaming provides WebSocket hub for real-time market data distribution.
// Supports channel-based subscriptions for tickers, order books, and trades.
package streaming

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Configure CORS in production via APISIX
	},
}

// Message represents a WebSocket message
type Message struct {
	Method  string          `json:"method"`
	Channel string          `json:"channel,omitempty"`
	Event   string          `json:"event,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	Params  *SubParams      `json:"params,omitempty"`
}

// SubParams represents subscription parameters
type SubParams struct {
	Channels []string `json:"channels"`
}

// Client represents a connected WebSocket client
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	channels map[string]bool
	mu       sync.Mutex
}

// Hub manages WebSocket client connections and message broadcasting
type Hub struct {
	clients    map[*Client]bool
	channels   map[string]map[*Client]bool
	broadcast  chan *ChannelMessage
	register   chan *Client
	unregister chan *Client
	logger     *zap.Logger
	mu         sync.RWMutex
}

// ChannelMessage represents a message to be broadcast to a specific channel
type ChannelMessage struct {
	Channel string
	Data    []byte
}

// NewHub creates a new WebSocket hub
func NewHub(logger *zap.Logger) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		channels:   make(map[string]map[*Client]bool),
		broadcast:  make(chan *ChannelMessage, 10000),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		logger:     logger,
	}
}

// Run starts the hub event loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			h.logger.Debug("Client connected", zap.Int("total", len(h.clients)))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				// Remove from all channels
				for channel := range client.channels {
					if subscribers, exists := h.channels[channel]; exists {
						delete(subscribers, client)
						if len(subscribers) == 0 {
							delete(h.channels, channel)
						}
					}
				}
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			if subscribers, exists := h.channels[msg.Channel]; exists {
				for client := range subscribers {
					select {
					case client.send <- msg.Data:
					default:
						// Client buffer full, disconnect
						close(client.send)
						delete(subscribers, client)
						delete(h.clients, client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// HandleWebSocket upgrades an HTTP connection to WebSocket
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", zap.Error(err))
		return
	}

	client := &Client{
		hub:      h,
		conn:     conn,
		send:     make(chan []byte, 256),
		channels: make(map[string]bool),
	}

	h.register <- client

	go client.writePump()
	go client.readPump()
}

// BroadcastToChannel sends data to all subscribers of a channel
func (h *Hub) BroadcastToChannel(channel string, data interface{}) {
	jsonData, err := json.Marshal(&Message{
		Channel: channel,
		Event:   "update",
		Data:    mustMarshal(data),
	})
	if err != nil {
		h.logger.Error("Failed to marshal broadcast data", zap.Error(err))
		return
	}

	h.broadcast <- &ChannelMessage{
		Channel: channel,
		Data:    jsonData,
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Method {
		case "subscribe":
			if msg.Params != nil {
				c.mu.Lock()
				for _, channel := range msg.Params.Channels {
					c.channels[channel] = true
					c.hub.mu.Lock()
					if _, exists := c.hub.channels[channel]; !exists {
						c.hub.channels[channel] = make(map[*Client]bool)
					}
					c.hub.channels[channel][c] = true
					c.hub.mu.Unlock()
				}
				c.mu.Unlock()
			}
		case "unsubscribe":
			if msg.Params != nil {
				c.mu.Lock()
				for _, channel := range msg.Params.Channels {
					delete(c.channels, channel)
					c.hub.mu.Lock()
					if subscribers, exists := c.hub.channels[channel]; exists {
						delete(subscribers, c)
					}
					c.hub.mu.Unlock()
				}
				c.mu.Unlock()
			}
		}
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()

	for message := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}

func mustMarshal(v interface{}) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}
