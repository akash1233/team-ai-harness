import { Input } from "@/components/ui/input";
import { Field } from "./field";
import type { AgentRates, PricingConfig } from "@/lib/types";
import { DEFAULT_PRICING, mergePricing } from "@/lib/pricing";

export function PricingFields({
  pricing,
  onChange,
}: {
  pricing: PricingConfig;
  onChange: (next: PricingConfig) => void;
}) {
  const rates = mergePricing(pricing);

  function setRate(agent: keyof Omit<PricingConfig, "charsPerToken">, key: keyof AgentRates, raw: string) {
    const n = Number(raw);
    onChange(
      mergePricing({
        ...rates,
        [agent]: { ...rates[agent], [key]: Number.isFinite(n) && n >= 0 ? n : 0 },
      }),
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">Token pricing (USD / million tokens)</h3>
      <p className="text-2xs text-muted">
        Used for the $ on tickets. HTTP/Studio/CIS use the usage object when the API returns it. Local CLI estimates tokens as characters ÷ chars-per-token. Defaults match Anthropic list prices (Aug 2026): Sonnet 5 $2 / $10, Haiku 4.5 $1 / $5.
      </p>
      <Field label="Characters per estimated token">
        <Input
          className="font-mono"
          type="number"
          min={1}
          step="1"
          value={String(rates.charsPerToken)}
          onChange={(e) =>
            onChange(mergePricing({ ...rates, charsPerToken: Number(e.target.value) || DEFAULT_PRICING.charsPerToken }))
          }
        />
      </Field>
      {(
        [
          ["claude", "Claude"],
          ["cursor", "Cursor"],
          ["studio", "Studio"],
          ["cis", "CIS"],
        ] as const
      ).map(([id, label]) => (
        <div key={id} className="grid gap-2 sm:grid-cols-[6rem_1fr_1fr] sm:items-end">
          <p className="text-sm font-medium">{label}</p>
          <Field label="Input $ / MTok">
            <Input
              className="font-mono"
              type="number"
              min={0}
              step="0.01"
              value={String(rates[id].inputUsdPerMTok)}
              onChange={(e) => setRate(id, "inputUsdPerMTok", e.target.value)}
            />
          </Field>
          <Field label="Output $ / MTok">
            <Input
              className="font-mono"
              type="number"
              min={0}
              step="0.01"
              value={String(rates[id].outputUsdPerMTok)}
              onChange={(e) => setRate(id, "outputUsdPerMTok", e.target.value)}
            />
          </Field>
        </div>
      ))}
    </section>
  );
}
