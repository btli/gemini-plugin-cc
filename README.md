# Gemini plugin for Claude Code

Use Gemini from inside Claude Code for code reviews or to delegate tasks to Gemini.

This plugin is for Claude Code users who want an easy way to start using Gemini from the workflow
they already have.

## What You Get

- `/gemini:review` for a normal read-only Gemini review
- `/gemini:adversarial-review` for a steerable challenge review
- `/gemini:rescue`, `/gemini:status`, `/gemini:result`, and `/gemini:cancel` to delegate work and manage background jobs

## Requirements

- **Google account or Gemini API key.**
  - Usage will contribute to your Gemini usage limits. [Learn more](https://ai.google.dev/pricing).
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add btli/gemini-plugin-cc
```

Install the plugin:

```bash
/plugin install gemini
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/gemini:setup
```

`/gemini:setup` will tell you whether Gemini is ready. If Gemini CLI is missing and npm is available, it can offer to install Gemini for you.

If you prefer to install Gemini yourself, use:

```bash
npm install -g @google/gemini-cli
```

If Gemini is installed but not logged in yet, run:

```bash
!gemini auth login
```

After install, you should see:

- the slash commands listed below
- the `gemini:gemini-rescue` subagent in `/agents`

One simple first run is:

```bash
/gemini:review --background
/gemini:status
/gemini:result
```

## Usage

### `/gemini:review`

Runs a normal Gemini review on your current work. It gives you a thorough code review covering bugs, security issues, performance problems, and maintainability concerns.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/gemini:adversarial-review`](#geminiadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/gemini:review
/gemini:review --base main
/gemini:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/gemini:status`](#geministatus) to check on the progress and [`/gemini:cancel`](#geminicancel) to cancel the ongoing task.

### `/gemini:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/gemini:review`, including `--base <ref>` for branch review.
It also supports `--wait` and `--background`. Unlike `/gemini:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/gemini:adversarial-review
/gemini:adversarial-review --base main challenge whether this was the right caching and retry design
/gemini:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/gemini:rescue`

Hands a task to Gemini through the `gemini:gemini-rescue` subagent.

Use it when you want Gemini to:

- investigate a bug
- try a fix
- continue a previous Gemini task
- take a faster or cheaper pass with a smaller model

> [!NOTE]
> Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, `--resume`, and `--fresh`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest rescue thread for this repo.

Examples:

```bash
/gemini:rescue investigate why the tests started failing
/gemini:rescue fix the failing test with the smallest safe patch
/gemini:rescue --resume apply the top fix from the last run
/gemini:rescue --model pro investigate the flaky integration test
/gemini:rescue --model flash fix the issue quickly
/gemini:rescue --background investigate the regression
```

You can also just ask for a task to be delegated to Gemini:

```text
Ask Gemini to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model`, the plugin defaults to `gemini-3.1-pro-preview`.
- if you say `flash`, the plugin maps that to `gemini-3-flash-preview`
- if you say `pro`, the plugin maps that to `gemini-3.1-pro-preview`
- if you say `auto`, the plugin maps that to `auto-gemini-3` (lets Gemini choose the best model)
- follow-up rescue requests can continue the latest Gemini task in the repo

### `/gemini:status`

Shows running and recent Gemini jobs for the current repository.

Examples:

```bash
/gemini:status
/gemini:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/gemini:result`

Shows the final stored Gemini output for a finished job.
When available, it also includes the Gemini session ID so you can reopen that run directly in Gemini with `gemini --resume <session-id>`.

Examples:

```bash
/gemini:result
/gemini:result task-abc123
```

### `/gemini:cancel`

Gracefully cancels an active background Gemini job. The plugin sends a cancel signal to the running ACP session, waits for the worker to persist any partial output, and then confirms cancellation. If the worker does not exit cleanly within 3 seconds, it is force-terminated.

Examples:

```bash
/gemini:cancel
/gemini:cancel task-abc123
```

### `/gemini:setup`

Checks whether Gemini is installed and authenticated.
If Gemini is missing and npm is available, it can offer to install Gemini for you.

You can also use `/gemini:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Gemini review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Gemini loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/gemini:review
```

### Hand A Problem To Gemini

```bash
/gemini:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/gemini:adversarial-review --background
/gemini:rescue --background investigate the flaky test
```

Then check in with:

```bash
/gemini:status
/gemini:result
```

## Architecture

This plugin mirrors the design of the official [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc), adapted for Google's Gemini ecosystem.

| | Codex plugin | Gemini plugin |
|---|---|---|
| **CLI** | [`@openai/codex`](https://developers.openai.com/codex/cli/) | [`@google/gemini-cli`](https://github.com/google-gemini/gemini-cli) |
| **Protocol** | JSON-RPC via Codex app server | JSON-RPC via ACP (Agent Communication Protocol) |
| **Session model** | Managed by app server broker | Direct subprocess — no broker |
| **Cancellation** | JSON-RPC cancel to app server | SIGTERM to worker, worker sends `session/cancel` on its own ACP connection |
| **Config format** | TOML (`.codex/config.toml`) | JSON (`.gemini/settings.json`) |
| **Auth** | ChatGPT account or OpenAI API key | Google account or Gemini API key |
| **Model aliases** | `spark` &rarr; `gpt-5.3-codex-spark` | `flash` &rarr; `gemini-3-flash-preview`, `pro` &rarr; `gemini-3.1-pro-preview` |

Both plugins share the same user-facing command surface (`review`, `adversarial-review`, `rescue`, `status`, `result`, `cancel`, `setup`) and the same background job system with foreground/background execution, session resume, and a stop-hook review gate.

### How it works

The plugin spawns `gemini --acp` as a child process and communicates over stdin/stdout using the [ACP protocol](https://github.com/google-gemini/gemini-cli) (JSON-RPC 2.0). Each task gets its own ACP session with:

- **Session setup timeouts** — all setup requests (`session/new`, `set_mode`, `set_model`, `session/load`) are wrapped in a 10-second timeout to prevent hangs if Gemini stalls during initialization.
- **Graceful cancellation** — background workers install a SIGTERM handler that sends `session/cancel` on the active ACP connection before closing. This preserves partial output instead of force-killing the transport. The cancel command sends SIGTERM to the worker first, waits up to 3 seconds for clean shutdown, and falls back to process tree termination.
- **Partial output preservation** — if a task fails (timeout, rate limit, crash), any streamed output accumulated before the failure is returned instead of being discarded.
- **Sandboxed file access** — Gemini's file read/write requests are confined to the workspace directory with symlink escape prevention. Files over 5 MB are rejected to prevent memory exhaustion.
- **Buffered logging** — streaming chunks are accumulated and flushed on line boundaries to reduce per-token sync I/O overhead.

## Gemini Integration

The Gemini plugin wraps the [Gemini CLI](https://github.com/google-gemini/gemini-cli). It uses the global `gemini` binary installed in your environment and applies the same configuration.

### Common Configurations

If you want to change the default model that gets used by the plugin, you can define that inside your user-level or project-level `settings.json`. For example to always use `gemini-2.5-pro` for a specific project you can add the following to a `.gemini/settings.json` file at the root of the directory you started Claude in:

```json
{
  "model": "gemini-2.5-pro"
}
```

Your configuration will be picked up based on:

- user-level config in `~/.gemini/settings.json`
- project-level overrides in `.gemini/settings.json`

Check out the [Gemini CLI docs](https://geminicli.com/docs/) for more configuration options.

### Moving The Work Over To Gemini

Delegated tasks and any [stop gate](#enabling-review-gate) run can also be directly resumed inside Gemini by running `gemini --resume` either with the specific session ID you received from running `/gemini:result` or `/gemini:status` or by selecting it from the list.

This way you can review the Gemini work or continue the work there.

## FAQ

### Do I need a separate Gemini account for this plugin?

If you are already signed into Gemini on this machine, that account should work immediately here too. This plugin uses your local Gemini CLI authentication.

If you only use Claude Code today and have not used Gemini yet, you will also need to sign in to Gemini with a Google account or an API key. [Gemini CLI is free to use](https://ai.google.dev/pricing), and `gemini auth login` supports Google OAuth sign-in. Run `/gemini:setup` to check whether Gemini is ready, and use `!gemini auth login` if it is not.

### Does the plugin use a separate Gemini runtime?

No. This plugin spawns your local [Gemini CLI](https://github.com/google-gemini/gemini-cli) as a subprocess using the ACP (Agent Communication Protocol) flag. There is no separate broker or app server — unlike the Codex plugin which relies on a Codex app server, the Gemini plugin communicates directly with the Gemini process over stdin/stdout.

That means:

- it uses the same Gemini install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment
- sessions created by the plugin can be resumed directly with `gemini --resume`

### Will it use the same Gemini config I already have?

Yes. If you already use Gemini, the plugin picks up the same [configuration](#common-configurations).

### Can I keep using my current API key setup?

Yes. Because the plugin uses your local Gemini CLI, your existing sign-in method and config still apply.

Set `GEMINI_API_KEY` or `GOOGLE_API_KEY` in your environment, or configure it in `~/.gemini/settings.json`.

## License

Apache-2.0
