# TraversalAI

TraversalAI is an AI operations platform for **Tourism Corps** teams.

It helps hospitality organizations run faster by connecting one assistant to the channels they already use, centralizing control in a local gateway, and automating routine workflows.

## What TraversalAI Does

- Operates as a multi-channel AI assistant across chat platforms.
- Provides a control center dashboard and agent-style chat UI.
- Supports tool-driven automations (sessions, messaging, scheduling, browser/tasks).
- Runs with local-first gateway architecture for reliability and control.

## Core Positioning

TraversalAI is built to accelerate hospitality outcomes:

- Faster guest-response workflows
- Cleaner internal handoffs
- Better operational visibility
- Safer automation with explicit controls

## Quick Start

Runtime: Node 22+

```bash
npm install -g traversalai@latest
traversalai onboard --install-daemon
traversalai dashboard --no-open
```

## From Source

```bash
git clone https://github.com/xplasma0/traversalai.git
cd traversalai
pnpm install
pnpm build
pnpm traversalai onboard --install-daemon
```

## Docs

- Getting started: https://docs.openclaw.ai/start/getting-started
- Gateway: https://docs.openclaw.ai/gateway
- Channels: https://docs.openclaw.ai/channels
- Security: https://docs.openclaw.ai/gateway/security
- Troubleshooting: https://docs.openclaw.ai/channels/troubleshooting

## Notes

- Product-facing naming in this repo is **TraversalAI**.
- Runtime compatibility remains aligned with existing `openclaw` internals unless migration is explicitly requested.

## Repository

- GitHub: https://github.com/xplasma0/traversalai
