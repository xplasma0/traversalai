import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { extractText } from "../ui/chat/message-extract.ts";
import { loadControlUiBootstrapConfig } from "../ui/controllers/control-ui-bootstrap.ts";
import { GatewayBrowserClient, type GatewayEventFrame } from "../ui/gateway.ts";
import { loadSettings, saveSettings } from "../ui/storage.ts";
import type {
  AgentsListResult,
  SessionsListResult,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../ui/types.ts";
import { generateUUID } from "../ui/uuid.ts";
import {
  cycleModelId,
  formatModelLabel,
  resolveAgentSessionKey,
  type ModelChoice,
} from "./technical-helpers.ts";

type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

function roleLabel(message: unknown): "You" | "Assistant" | "Tool" {
  const roleRaw = (message as { role?: unknown })?.role;
  const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "";
  if (role === "user") {
    return "You";
  }
  if (role === "tool" || role === "toolresult") {
    return "Tool";
  }
  return "Assistant";
}

function canAutoscroll(log: HTMLElement): boolean {
  const fromBottom = log.scrollHeight - log.clientHeight - log.scrollTop;
  return fromBottom < 80;
}

@customElement("technical-chat-app")
export class TechnicalChatApp extends LitElement {
  createRenderRoot() {
    return this;
  }

  private client: GatewayBrowserClient | null = null;
  private shouldScroll = true;

  @state() private settings = loadSettings();
  @state() private gatewayUrl = this.settings.gatewayUrl;
  @state() private token = this.settings.token;
  @state() private connected = false;
  @state() private connecting = false;
  @state() private lastError: string | null = null;
  @state() private infoMessage: string | null = null;

  @state() private assistantName = "Assistant";
  @state() private assistantAvatar = "A";

  @state() private agents: AgentsListResult | null = null;
  @state() private selectedAgentId = "";
  @state() private sessionKey = this.settings.sessionKey;

  @state() private models: ModelChoice[] = [];
  @state() private selectedModelId = "";

  @state() private toolsCatalog: ToolsCatalogResult | null = null;
  @state() private skillsReport: SkillStatusReport | null = null;
  @state() private sidebarTab: "tools" | "skills" = "tools";

  @state() private messages: unknown[] = [];
  @state() private stream: string | null = null;
  @state() private runId: string | null = null;
  @state() private draft = "";
  @state() private sending = false;
  @state() private loading = false;

  connectedCallback() {
    super.connectedCallback();
    const bootstrapState = {
      basePath: "",
      assistantName: this.assistantName,
      assistantAvatar: this.assistantAvatar,
      assistantAgentId: null,
    };
    void loadControlUiBootstrapConfig(bootstrapState).then(() => {
      this.assistantName = bootstrapState.assistantName;
      this.assistantAvatar = bootstrapState.assistantAvatar ?? this.assistantAvatar;
      this.requestUpdate();
    });
    this.connect();
  }

  disconnectedCallback() {
    this.client?.stop();
    this.client = null;
    super.disconnectedCallback();
  }

  updated() {
    if (!this.shouldScroll) {
      return;
    }
    const log = this.querySelector<HTMLElement>(".easy-chat-log");
    if (!log || !canAutoscroll(log)) {
      return;
    }
    log.scrollTop = log.scrollHeight;
    this.shouldScroll = false;
  }

  private persistSettings() {
    this.settings = {
      ...this.settings,
      gatewayUrl: this.gatewayUrl.trim(),
      token: this.token,
      sessionKey: this.sessionKey,
      lastActiveSessionKey: this.sessionKey,
    };
    saveSettings(this.settings);
  }

  private connect() {
    this.lastError = null;
    this.infoMessage = null;
    this.connecting = true;
    this.persistSettings();

    const previous = this.client;
    const next = new GatewayBrowserClient({
      url: this.gatewayUrl.trim(),
      token: this.token.trim() ? this.token.trim() : undefined,
      clientName: "openclaw-control-ui",
      mode: "ui",
      instanceId: generateUUID(),
      onHello: () => {
        this.connected = true;
        this.connecting = false;
        this.lastError = null;
        void this.refreshEverything();
      },
      onClose: ({ code, reason, error }) => {
        this.connected = false;
        this.connecting = false;
        this.lastError = error?.message ?? `Disconnected (${code}): ${reason || "No reason"}`;
      },
      onEvent: (event) => this.handleEvent(event),
    });

    this.client = next;
    previous?.stop();
    next.start();
  }

  private async refreshEverything() {
    await Promise.all([this.loadAgents(), this.loadModels()]);
    await Promise.all([
      this.loadChatHistory(),
      this.loadSessionSelection(),
      this.loadTools(),
      this.loadSkills(),
    ]);
  }

  private async loadAgents() {
    if (!this.client || !this.connected) {
      return;
    }
    const res = await this.client.request<AgentsListResult>("agents.list", {});
    this.agents = res;
    const known = new Set(res.agents.map((entry) => entry.id));
    const fromSession = parseAgentSessionKey(this.sessionKey)?.agentId ?? "";
    const preferred =
      (fromSession && known.has(fromSession) ? fromSession : "") ||
      (this.selectedAgentId && known.has(this.selectedAgentId) ? this.selectedAgentId : "") ||
      res.defaultId ||
      res.agents[0]?.id ||
      "";
    if (preferred && preferred !== this.selectedAgentId) {
      this.selectedAgentId = preferred;
      this.sessionKey = resolveAgentSessionKey(preferred, res.mainKey);
      this.persistSettings();
    }
  }

  private async loadModels() {
    if (!this.client || !this.connected) {
      return;
    }
    const res = await this.client.request<{ models?: ModelChoice[] }>("models.list", {});
    this.models = Array.isArray(res.models) ? res.models : [];
    if (this.selectedModelId && this.models.every((entry) => entry.id !== this.selectedModelId)) {
      this.selectedModelId = "";
    }
  }

  private async loadSessionSelection() {
    if (!this.client || !this.connected) {
      return;
    }
    const res = await this.client.request<SessionsListResult>("sessions.list", {
      limit: 120,
      includeGlobal: true,
      includeUnknown: true,
      agentId: this.selectedAgentId || undefined,
    });
    const active = res.sessions.find((entry) => entry.key === this.sessionKey);
    this.selectedModelId = active?.model ?? "";
  }

  private async loadChatHistory() {
    if (!this.client || !this.connected) {
      return;
    }
    this.loading = true;
    try {
      const res = await this.client.request<{ messages?: unknown[] }>("chat.history", {
        sessionKey: this.sessionKey,
        limit: 200,
      });
      this.messages = Array.isArray(res.messages) ? res.messages : [];
      this.stream = null;
      this.runId = null;
      this.shouldScroll = true;
    } finally {
      this.loading = false;
    }
  }

  private async loadTools() {
    if (!this.client || !this.connected) {
      return;
    }
    this.toolsCatalog = await this.client.request<ToolsCatalogResult>("tools.catalog", {
      agentId: this.selectedAgentId || undefined,
      includePlugins: true,
    });
  }

  private async loadSkills() {
    if (!this.client || !this.connected) {
      return;
    }
    this.skillsReport = await this.client.request<SkillStatusReport>("skills.status", {
      agentId: this.selectedAgentId || undefined,
    });
  }

  private handleEvent(event: GatewayEventFrame) {
    if (event.event !== "chat.event") {
      return;
    }
    const payload = event.payload as ChatEventPayload | undefined;
    if (!payload || payload.sessionKey !== this.sessionKey) {
      return;
    }

    if (this.runId && payload.runId && payload.runId !== this.runId) {
      if (payload.state === "final" && payload.message) {
        this.messages = [...this.messages, payload.message];
      }
      this.shouldScroll = true;
      return;
    }

    if (payload.state === "delta") {
      const next = extractText(payload.message);
      if (typeof next === "string") {
        this.stream = next;
      }
    } else if (payload.state === "final") {
      if (payload.message) {
        this.messages = [...this.messages, payload.message];
      }
      this.stream = null;
      this.runId = null;
    } else if (payload.state === "aborted") {
      if (payload.message) {
        this.messages = [...this.messages, payload.message];
      } else if (this.stream?.trim()) {
        this.messages = [
          ...this.messages,
          {
            role: "assistant",
            content: [{ type: "text", text: this.stream }],
            timestamp: Date.now(),
          },
        ];
      }
      this.stream = null;
      this.runId = null;
    } else if (payload.state === "error") {
      this.lastError = payload.errorMessage ?? "Chat run failed";
      this.stream = null;
      this.runId = null;
    }
    this.shouldScroll = true;
  }

  private async switchAgent(agentId: string) {
    if (!agentId || agentId === this.selectedAgentId) {
      return;
    }
    this.selectedAgentId = agentId;
    this.sessionKey = resolveAgentSessionKey(agentId, this.agents?.mainKey);
    this.persistSettings();
    await Promise.all([
      this.loadSessionSelection(),
      this.loadChatHistory(),
      this.loadTools(),
      this.loadSkills(),
    ]);
  }

  private async applyModel(modelId: string) {
    if (!this.client || !this.connected) {
      return;
    }
    this.selectedModelId = modelId;
    try {
      await this.client.request("sessions.patch", {
        key: this.sessionKey,
        model: modelId || null,
      });
      this.infoMessage = modelId ? "Model changed for this chat." : "Using default model.";
      this.lastError = null;
    } catch (error) {
      this.lastError = String(error);
    }
  }

  private async cycleModel(direction: "next" | "prev") {
    if (this.models.length === 0) {
      return;
    }
    const nextId = cycleModelId(this.models, this.selectedModelId, direction);
    await this.applyModel(nextId);
  }

  private async send() {
    const text = this.draft.trim();
    if (!text || !this.client || !this.connected) {
      return;
    }
    const runId = generateUUID();
    this.messages = [
      ...this.messages,
      { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
    ];
    this.draft = "";
    this.sending = true;
    this.runId = runId;
    this.stream = "";
    this.shouldScroll = true;
    this.lastError = null;

    try {
      await this.client.request("chat.send", {
        sessionKey: this.sessionKey,
        message: text,
        idempotencyKey: runId,
        deliver: false,
      });
    } catch (error) {
      this.lastError = String(error);
      this.stream = null;
      this.runId = null;
      this.messages = [
        ...this.messages,
        {
          role: "assistant",
          content: [{ type: "text", text: `Error: ${String(error)}` }],
          timestamp: Date.now(),
        },
      ];
    } finally {
      this.sending = false;
    }
  }

  private async abort() {
    if (!this.client || !this.connected) {
      return;
    }
    try {
      await this.client.request("chat.abort", {
        sessionKey: this.sessionKey,
        runId: this.runId ?? undefined,
      });
    } catch (error) {
      this.lastError = String(error);
    }
  }

  private async resetChat() {
    if (!this.client || !this.connected) {
      return;
    }
    await this.client.request("sessions.reset", {
      key: this.sessionKey,
      reason: "new",
    });
    await this.loadChatHistory();
  }

  render() {
    const status = this.connected
      ? "Connected"
      : this.connecting
        ? "Connecting..."
        : "Disconnected";
    const sendDisabled = !this.connected || this.sending || !this.draft.trim();

    return html`
      <div class="easy-shell">
        <aside class="easy-sidebar">
          <div class="easy-brand">
            <div class="easy-brand__avatar">${this.assistantAvatar || "A"}</div>
            <div>
              <h1>Easy Chat UI</h1>
              <p>${this.assistantName}</p>
            </div>
          </div>

          <label class="easy-field">
            <span>Gateway URL</span>
            <input
              .value=${this.gatewayUrl}
              @input=${(event: Event) =>
                (this.gatewayUrl = (event.target as HTMLInputElement).value)}
              placeholder="ws://localhost:18789"
            />
          </label>

          <label class="easy-field">
            <span>Token (optional)</span>
            <input
              .value=${this.token}
              @input=${(event: Event) => (this.token = (event.target as HTMLInputElement).value)}
              placeholder="Gateway auth token"
            />
          </label>

          <button class="easy-btn easy-btn--full" @click=${() => this.connect()}>
            ${this.connected ? "Reconnect" : "Connect"}
          </button>

          <div class="easy-status">${status}</div>

          <label class="easy-field">
            <span>Agent</span>
            <select
              .value=${this.selectedAgentId}
              ?disabled=${!this.connected}
              @change=${(event: Event) =>
                void this.switchAgent((event.target as HTMLSelectElement).value)}
            >
              ${(this.agents?.agents ?? []).map(
                (agent) => html`<option value=${agent.id}>${agent.name || agent.id}</option>`,
              )}
            </select>
          </label>

          <div class="easy-field">
            <span>Model</span>
            <div class="easy-model-row">
              <button class="easy-btn" ?disabled=${!this.models.length} @click=${() => void this.cycleModel("prev")}>
                ◀
              </button>
              <select
                .value=${this.selectedModelId}
                ?disabled=${!this.connected || !this.models.length}
                @change=${(event: Event) =>
                  void this.applyModel((event.target as HTMLSelectElement).value)}
              >
                <option value="">Default</option>
                ${this.models.map(
                  (model) => html`<option value=${model.id}>${formatModelLabel(model)}</option>`,
                )}
              </select>
              <button class="easy-btn" ?disabled=${!this.models.length} @click=${() => void this.cycleModel("next")}>
                ▶
              </button>
            </div>
          </div>

          <div class="easy-tabs">
            <button
              class="easy-tab ${this.sidebarTab === "tools" ? "is-active" : ""}"
              @click=${() => (this.sidebarTab = "tools")}
            >
              Tools
            </button>
            <button
              class="easy-tab ${this.sidebarTab === "skills" ? "is-active" : ""}"
              @click=${() => (this.sidebarTab = "skills")}
            >
              Skills
            </button>
          </div>

          <div class="easy-panel">
            ${
              this.sidebarTab === "tools"
                ? html`
                    ${(this.toolsCatalog?.groups ?? []).map(
                      (group) => html`
                        <details>
                          <summary>${group.label} (${group.tools.length})</summary>
                          <ul>
                            ${group.tools.map((tool) => html`<li>${tool.label}</li>`)}
                          </ul>
                        </details>
                      `,
                    )}
                  `
                : html`
                    ${(this.skillsReport?.skills ?? []).map(
                      (skill) => html`
                        <div class="easy-skill">
                          <div class="easy-skill__title">${skill.emoji ?? ""} ${skill.name}</div>
                          <div class="easy-skill__meta">
                            ${skill.eligible ? "Ready" : "Needs setup"}
                            ${skill.missing.bins.length ? ` • Missing: ${skill.missing.bins.join(", ")}` : ""}
                          </div>
                        </div>
                      `,
                    )}
                  `
            }
          </div>
        </aside>

        <main class="easy-main">
          <div class="easy-topbar">
            <div class="easy-session">Session: ${this.sessionKey}</div>
            <div class="easy-topbar__actions">
              <button class="easy-btn" ?disabled=${!this.connected} @click=${() => void this.resetChat()}>
                New Chat
              </button>
              <button class="easy-btn" ?disabled=${!this.connected} @click=${() => void this.refreshEverything()}>
                Refresh
              </button>
            </div>
          </div>

          ${this.lastError ? html`<div class="easy-alert easy-alert--error">${this.lastError}</div>` : nothing}
          ${this.infoMessage ? html`<div class="easy-alert">${this.infoMessage}</div>` : nothing}

          <div class="easy-chat-log">
            ${
              this.loading
                ? html`
                    <div class="easy-muted">Loading messages...</div>
                  `
                : this.messages.map((message) => {
                    const text = extractText(message) || "(non-text message)";
                    const role = roleLabel(message);
                    const roleClass = role.toLowerCase();
                    return html`
                      <article class="easy-message easy-message--${roleClass}">
                        <header>${role}</header>
                        <p>${text}</p>
                      </article>
                    `;
                  })
            }
            ${
              this.stream !== null
                ? html`
                    <article class="easy-message easy-message--assistant">
                      <header>Assistant</header>
                      <p>${this.stream || "..."}</p>
                    </article>
                  `
                : nothing
            }
          </div>

          <div class="easy-compose">
            <textarea
              .value=${this.draft}
              ?disabled=${!this.connected}
              @input=${(event: Event) => (this.draft = (event.target as HTMLTextAreaElement).value)}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void this.send();
                }
              }}
              placeholder="Type your message and press Enter..."
            ></textarea>
            <div class="easy-compose__actions">
              <button class="easy-btn" ?disabled=${!this.runId} @click=${() => void this.abort()}>
                Stop
              </button>
              <button class="easy-btn easy-btn--primary" ?disabled=${sendDisabled} @click=${() => void this.send()}>
                Send
              </button>
            </div>
          </div>
        </main>
      </div>
    `;
  }
}
