# Gemini plugin for Claude Code

Use Gemini from inside Claude Code for code reviews or to delegate tasks to Gemini.

This plugin is for Claude Code users who want an easy way to start using Gemini from the workflow
they already have.

## What You Get

- `/gemini:review` for a standard Gemini code review
- `/gemini:adversarial-review` for a steerable challenge review
- `/gemini:rescue`, `/gemini:status`, `/gemini:result`, and `/gemini:cancel` to delegate work and manage background jobs

## Requirements

- **Google account or Gemini API key.**
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

`/gemini:setup` will tell you whether Gemini is ready. If Gemini CLI is missing and npm is available, it can offer to install it for you.

If you prefer to install Gemini CLI yourself, use:

```bash
npm install -g @google/gemini-cli
```

If Gemini CLI is installed but not authenticated yet, run:

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

Runs a Gemini review on your current work.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`.

Examples:

```bash
/gemini:review
/gemini:review --base main
/gemini:review --background
```

This command is read-only and will not perform any changes.

### `/gemini:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

Unlike `/gemini:review`, it can take extra focus text after the flags.

Examples:

```bash
/gemini:adversarial-review
/gemini:adversarial-review --base main challenge whether this was the right caching design
/gemini:adversarial-review --background look for race conditions
```

This command is read-only.

### `/gemini:rescue`

Hands a task to Gemini through the `gemini:gemini-rescue` subagent.

Use it when you want Gemini to:

- investigate a bug
- try a fix
- continue a previous Gemini task
- take a pass with a different model

It supports `--background`, `--wait`, `--resume`, and `--fresh`.

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

**Model aliases:**

- `flash` maps to `gemini-3-flash`
- `pro` maps to `gemini-3.1-pro`

### `/gemini:status`

Shows running and recent Gemini jobs for the current repository.

Examples:

```bash
/gemini:status
/gemini:status task-abc123
```

### `/gemini:result`

Shows the final stored Gemini output for a finished job.
When available, it also includes the Gemini session ID so you can resume that run directly with `gemini --resume <session-id>`.

Examples:

```bash
/gemini:result
/gemini:result task-abc123
```

### `/gemini:cancel`

Cancels an active background Gemini job.

Examples:

```bash
/gemini:cancel
/gemini:cancel task-abc123
```

### `/gemini:setup`

Checks whether Gemini CLI is installed and authenticated.
If Gemini CLI is missing and npm is available, it can offer to install it for you.

You can also use `/gemini:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Gemini review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> **Warning:** The review gate can create a long-running Claude/Gemini loop and may drain usage quickly. Only enable it when you plan to actively monitor the session.

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

## Gemini Integration

The plugin wraps the [Gemini CLI](https://github.com/google-gemini/gemini-cli). It uses the global `gemini` binary installed in your environment.

### Common Configurations

Gemini CLI uses `~/.gemini/settings.json` for global configuration and `.gemini/settings.json` for project-level overrides.

### Moving The Work Over To Gemini

Delegated tasks can be directly resumed inside Gemini CLI by running `gemini --resume <session-id>` with the session ID from `/gemini:result` or `/gemini:status`.

## FAQ

### Do I need a separate Gemini account?

If you are already signed into Gemini CLI on this machine, that account works here too. This plugin uses your local Gemini CLI authentication.

If you have not used Gemini CLI yet, you will need to authenticate. Run `/gemini:setup` to check, and use `!gemini auth login` if needed.

### Does the plugin use a separate runtime?

No. This plugin delegates through your local Gemini CLI on the same machine. That means:

- it uses the same Gemini install you would use directly
- it uses the same authentication state
- it uses the same repository checkout and environment

### Can I use my API key?

Yes. Set `GEMINI_API_KEY` or `GOOGLE_API_KEY` in your environment, or configure it in `~/.gemini/settings.json`.

## License

Apache-2.0
