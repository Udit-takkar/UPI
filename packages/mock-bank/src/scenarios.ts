export type Behavior = "success" | "failure" | "timeout" | "error";

export interface Scenario {
  behavior: Behavior;
  responseCode: string;
  delayMs: number;
}

const DEFAULT_SCENARIO: Scenario = {
  behavior: "success",
  responseCode: "00",
  delayMs: 150,
};

const scenarios = new Map<string, Scenario>();

function key(bankSlug: string, operation: string): string {
  return `${bankSlug}:${operation}`;
}

export function getScenario(bankSlug: string, operation: string): Scenario {
  return scenarios.get(key(bankSlug, operation)) ?? DEFAULT_SCENARIO;
}

export function setScenario(
  bankSlug: string,
  operation: string,
  scenario: Partial<Scenario>,
): void {
  scenarios.set(key(bankSlug, operation), {
    ...DEFAULT_SCENARIO,
    ...scenario,
  });
}

export function clearScenarios(): void {
  scenarios.clear();
}
