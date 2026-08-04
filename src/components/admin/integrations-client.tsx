"use client";

import { useState } from "react";
import { KeyRound, BookOpen } from "lucide-react";
import { ApiKeysManager } from "@/components/admin/api-keys-manager";
import { ApiDocumentation } from "@/components/admin/api-documentation";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
};

type Tab = "api-keys" | "api-docs";

const TABS = [
  {
    id: "api-keys" as Tab,
    label: "API Keys",
    icon: KeyRound,
    title: "API Keys",
    description: "Generate and manage API keys for external integrations. Keys are shown once at creation — store them securely.",
  },
  {
    id: "api-docs" as Tab,
    label: "API Documentation",
    icon: BookOpen,
    title: "API Documentation",
    description: "Reference for the external REST API — authentication, endpoints, and example requests.",
  },
];

interface Props {
  apiKeys: ApiKey[];
  initialTab?: string;
}

export function IntegrationsClient({ apiKeys, initialTab }: Props) {
  const defaultTab = TABS.some((t) => t.id === initialTab) ? (initialTab as Tab) : "api-keys";
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  const current = TABS.find((t) => t.id === activeTab);

  return (
    <div className="mt-6 flex overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800" style={{ minHeight: "500px" }}>
      {/* Left nav */}
      <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
        <ul className="py-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {tab.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Right content */}
      <div className="flex-1 overflow-auto bg-white p-6 dark:bg-zinc-950">
        {current && (
          <>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{current.title}</h2>
            {current.description && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{current.description}</p>
            )}
            {activeTab === "api-keys" && <ApiKeysManager apiKeys={apiKeys} />}
            {activeTab === "api-docs" && <ApiDocumentation />}
          </>
        )}
      </div>
    </div>
  );
}
