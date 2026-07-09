"use client";

import { ChevronDown, ClipboardCheck, Gauge, Wand2, type LucideIcon } from "lucide-react";
import { useState } from "react";

export type ProductId = "spec-generator" | "tech-launch" | "spec-check";

const products: Array<{ id: ProductId; label: string; description: string; href: string; icon: LucideIcon }> = [
  {
    id: "spec-generator",
    label: "Spec Generator",
    description: "Create and manage tracking specs",
    href: "/",
    icon: Wand2,
  },
  {
    id: "tech-launch",
    label: "Tech Launch",
    description: "Readiness telemetry dashboard",
    href: "/tech-launch",
    icon: Gauge,
  },
  {
    id: "spec-check",
    label: "Spec Check",
    description: "Compare live data to saved specs",
    href: "/spec-check",
    icon: ClipboardCheck,
  },
];

export default function ProductSwitcher({ current, collapsed = false }: { current: ProductId; collapsed?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = products.find((product) => product.id === current) ?? products[0];
  const SelectedIcon = selected.icon;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button
        type="button"
        title={collapsed ? selected.label : undefined}
        aria-label="Switch product"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`focus-ring flex h-11 w-full items-center gap-3 rounded-md border border-line bg-mist px-3 text-left text-sm font-semibold text-ink hover:bg-sage ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        <span className={`flex min-w-0 items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
          <SelectedIcon className="h-4 w-4 shrink-0 text-cobalt" />
          {collapsed ? null : (
            <span className="min-w-0 max-md:hidden">
              <span className="block truncate text-[11px] font-bold uppercase text-slate-500">Product</span>
              <span className="block truncate">{selected.label}</span>
            </span>
          )}
        </span>
        {collapsed ? null : <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />}
      </button>

      {isOpen ? (
        <div className={`absolute left-0 z-50 mt-2 w-72 rounded-md border border-line bg-surface-highest p-1 shadow-soft ${collapsed ? "top-0 translate-x-14" : "top-full"}`}>
          {products.map((product) => {
            const Icon = product.icon;
            const isCurrent = product.id === current;
            return (
              <a
                key={product.id}
                href={product.href}
                aria-current={isCurrent ? "page" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                className={`focus-ring flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors ${
                  isCurrent ? "bg-cobalt/15 text-ink" : "text-slate-500 hover:bg-sage hover:text-ink"
                }`}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isCurrent ? "text-cobalt" : "text-slate-500"}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{product.label}</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">{product.description}</span>
                </span>
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
