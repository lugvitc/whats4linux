export class LRUCache<K, V> {
  private readonly entries = new Map<K, { value: V; weight: number }>()
  private totalWeight = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight = Number.POSITIVE_INFINITY,
    private readonly weightOf: (value: V) => number = () => 1,
  ) {}

  get size() {
    return this.entries.size
  }

  get weight() {
    return this.totalWeight
  }

  has(key: K) {
    return this.entries.has(key)
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    // Map iteration order is the eviction order. Reinsert reads at the end so
    // frequently revisited virtualized rows survive cache pressure.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V) {
    const weight = Math.max(0, this.weightOf(value))
    const previous = this.entries.get(key)
    if (previous) {
      this.entries.delete(key)
      this.totalWeight -= previous.weight
    }

    // A single oversized data URL should not evict the useful cache and then
    // remain as an unbounded entry itself.
    if (this.maxEntries <= 0 || weight > this.maxWeight) return this

    this.entries.set(key, { value, weight })
    this.totalWeight += weight
    while (this.entries.size > this.maxEntries || this.totalWeight > this.maxWeight) {
      const oldest = this.entries.entries().next().value as
        [K, { value: V; weight: number }] | undefined
      if (!oldest) break
      this.entries.delete(oldest[0])
      this.totalWeight -= oldest[1].weight
    }
    return this
  }
}
