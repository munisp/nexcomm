// Package registry implements the CBS (Core Banking System) adapter plugin registry.
//
// Any custom CBS can be integrated by implementing the models.CBSAdapter interface
// and registering it with Register() before the service starts. The active adapter
// is selected at runtime via the CBS_PROVIDER environment variable.
//
// Built-in adapters (temenos, finacle, mambu, mock) are pre-registered by the
// main package. Third-party or custom adapters can be added by importing a package
// that calls registry.Register() in its init() function — the same pattern used
// by Go's database/sql drivers.
//
// Example — custom CBS adapter:
//
//	package mycbs
//
//	import (
//	    "github.com/nexcom/core-banking/internal/registry"
//	    "github.com/nexcom/core-banking/internal/models"
//	)
//
//	func init() {
//	    registry.Register("mycbs", func(cfg map[string]string, log *zap.Logger) (models.CBSAdapter, error) {
//	        return &MyAdapter{
//	            baseURL: cfg["base_url"],
//	            apiKey:  cfg["api_key"],
//	            log:     log,
//	        }, nil
//	    })
//	}
package registry

import (
	"fmt"
	"sync"

	"github.com/nexcom/core-banking/internal/models"
	"go.uber.org/zap"
)

// FactoryFunc is a function that creates a new CBSAdapter from a config map.
// The config map contains all environment variables prefixed with the provider
// name in uppercase, e.g. for provider "mycbs":
//
//	MYCBS_BASE_URL → cfg["base_url"]
//	MYCBS_API_KEY  → cfg["api_key"]
type FactoryFunc func(cfg map[string]string, log *zap.Logger) (models.CBSAdapter, error)

var (
	mu       sync.RWMutex
	adapters = make(map[string]FactoryFunc)
)

// Register registers a CBS adapter factory under the given provider name.
// Provider names are case-insensitive and normalized to lowercase.
// Panics if the same provider name is registered twice (same as database/sql).
func Register(provider string, factory FactoryFunc) {
	mu.Lock()
	defer mu.Unlock()
	if _, exists := adapters[provider]; exists {
		panic(fmt.Sprintf("core-banking registry: adapter %q already registered", provider))
	}
	adapters[provider] = factory
}

// Lookup returns the factory for the given provider name, or an error if not found.
func Lookup(provider string) (FactoryFunc, error) {
	mu.RLock()
	defer mu.RUnlock()
	factory, ok := adapters[provider]
	if !ok {
		return nil, fmt.Errorf("core-banking registry: unknown CBS provider %q — available: %v", provider, Providers())
	}
	return factory, nil
}

// Providers returns a sorted list of all registered provider names.
func Providers() []string {
	mu.RLock()
	defer mu.RUnlock()
	names := make([]string, 0, len(adapters))
	for name := range adapters {
		names = append(names, name)
	}
	return names
}

// Build creates a CBS adapter for the given provider using the supplied config map.
// This is the primary entry point used by main.go.
func Build(provider string, cfg map[string]string, log *zap.Logger) (models.CBSAdapter, error) {
	factory, err := Lookup(provider)
	if err != nil {
		return nil, err
	}
	return factory(cfg, log)
}
