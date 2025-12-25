package misc

import (
	"sync"
)

// VMap is a thread-safe generic map with read-write mutex protection.
// It provides concurrent access to key-value pairs of any comparable key type.
type VMap[kT comparable, vT any] struct {
	kv map[kT]vT
	mu sync.RWMutex
}

// NewVMap creates and returns a new empty VMap instance with an initialized internal map.
func NewVMap[kT comparable, vT any]() VMap[kT, vT] {
	return VMap[kT, vT]{
		kv: make(map[kT]vT),
	}
}

// Make initializes the internal map. Call this to reset the map or if using a zero-value VMap.
func (vm *VMap[kT, vT]) Make() {
	vm.kv = make(map[kT]vT)
}

// Set stores a value for the given key with write lock protection.
func (vm *VMap[kT, vT]) Set(key kT, val vT) {
	vm.mu.Lock()
	defer vm.mu.Unlock()
	vm.kv[key] = val
}

// GetUnsafe retrieves a value without lock protection. Use only when already holding a lock.
func (vm *VMap[kT, vT]) GetUnsafe(key kT) (val vT, ok bool) {
	val, ok = vm.kv[key]
	return
}

// Get retrieves a value for the given key with read lock protection.
func (vm *VMap[kT, vT]) Get(key kT) (val vT, ok bool) {
	vm.mu.RLock()
	defer vm.mu.RUnlock()
	val, ok = vm.kv[key]
	return
}

// GetMap returns the internal map with read lock protection.
func (kv *VMap[kT, vT]) GetMapWithMutex() (map[kT]vT, *sync.RWMutex) {
	return kv.kv, &kv.mu
}

// Dump returns all keys and values as separate slices with write lock protection.
func (vm *VMap[kT, vT]) Dump() (keys []kT, vals []vT) {
	n := len(vm.kv)

	keys = make([]kT, n)
	vals = make([]vT, n)

	vm.mu.Lock()
	defer vm.mu.Unlock()

	var i int
	for key, val := range vm.kv {
		keys[i] = key
		vals[i] = val
		i++
	}
	return
}
