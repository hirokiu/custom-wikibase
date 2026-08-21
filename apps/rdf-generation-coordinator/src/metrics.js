const COUNTERS = [
  "cleanup_total",
  "ambiguous_states_total",
  "active_rebuilds",
  "active_retirements",
  "promotion_failures_total",
  "promotions_total",
  "rebuild_failure_total",
  "rebuild_requests_total",
  "rebuild_success_total",
  "reconciliation_total",
  "retirements_total",
  "rollbacks_total",
];

export class CoordinatorMetrics {
  constructor() { this.values = new Map(COUNTERS.map((name) => [name, 0])); }
  increment(name) { this.values.set(name, (this.values.get(name) ?? 0) + 1); }
  set(name, value) { this.values.set(name, Number(value)); }
  render() { return [...this.values.entries()].sort().map(([name, value]) => `jwb_coordinator_${name} ${value}`).join("\n") + "\n"; }
}
