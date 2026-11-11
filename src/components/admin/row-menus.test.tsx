// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/actions/api-key.actions", () => ({ createApiKey: vi.fn(), revokeApiKey: vi.fn(), regenerateApiKey: vi.fn(), setApiKeyScopes: vi.fn() }));
vi.mock("@/actions/webhook.actions", () => ({
  createWebhook: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  removeWebhook: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  sendWebhookTest: vi.fn(),
  setWebhookActive: vi.fn(),
}));

import { ApiKeysManager } from "./api-keys-manager";
import { WebhooksManager } from "./webhooks-manager";

/**
 * The row menus on Integrations, on the shared menu: each action with its
 * icon, the removing one set apart in red, and the menu closes on Escape or
 * a press outside without doing anything.
 */
afterEach(cleanup);

const key = { id: "k1", name: "Payroll export", keyPrefix: "ct_abc", createdAt: new Date(), lastUsedAt: null, isActive: true, scopes: [] };
const hook = {
  id: "w1",
  name: "Ticketing",
  url: "https://example.test/hook",
  events: ["employee.terminated"],
  isActive: true,
  createdAt: new Date(),
  sendsHere: true,
  last: null,
};

describe("Key actions", () => {
  it("opens the shared menu, revoke set apart in red, and closes on Escape", () => {
    render(<ApiKeysManager apiKeys={[key]} filter="all" createOpen={false} onCreateOpenChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Key actions" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Key actions" });
    const items = within(menu).getAllByRole("menuitem").map((b) => b.textContent);
    expect(items).toEqual(["Allow time off requests", "Allow directory access", "Regenerate", "Revoke"]);
    expect(within(menu).getByRole("menuitem", { name: "Revoke" }).getAttribute("data-tone")).toBe("danger");
    expect(within(menu).getByRole("separator")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Webhook actions", () => {
  it("opens the shared menu, remove set apart in red, and closes on a press outside", () => {
    render(<WebhooksManager hooks={[hook]} ready note={null} createOpen={false} onCreateOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Webhook actions" }));
    const menu = screen.getByRole("menu", { name: "Webhook actions" });
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Send test", "Deliveries", "Pause", "New secret", "Remove"]);
    expect(within(menu).getByRole("menuitem", { name: "Remove" }).getAttribute("data-tone")).toBe("danger");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
