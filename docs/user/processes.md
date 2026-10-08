# Processes

Open **Processes** from the sidebar or the command palette, or press `mod+alt+p` on web and
desktop when the terminal is not focused. Customize `processes.open` in
**Settings → Keybindings**.

## See what is running

The left column lists long-running commands on the selected environment, newest first. Each
card shows the project, branch, ports, uptime, and who started it, with a link to the thread it
came from. It finds:

- commands running in T3 terminals;
- project actions you or an agent started;
- shell commands an agent has been running for more than a few seconds, such as a background dev
  server;
- processes started elsewhere, such as another terminal app, that run inside one of your
  project folders or listen on a port.

Processes started elsewhere are grouped under **External**, collapsed until you open it. Coding
agents such as Claude Code, Codex, or Gemini CLI are labeled by name, and the collapsed section
shows which ones are running.

Select a card to see its live output on the right; **Actions** takes you back. A terminal
command with no output for ten minutes is marked **Quiet**, which often means it is stuck or
waiting for input. On the machine you use T3 Code on, select a port to open it in your browser.

**Stop** sends Ctrl-C to terminal commands, then stops anything still running. T3 Code asks
before it stops a process it did not start. Windows hosts list commands in T3 terminals only.

## Run project actions

The right column groups each project's actions: its saved actions and the commands T3 Code
discovered in `t3.json`, `package.json` scripts, a `Makefile`, or a `Procfile`. **Run** starts the
command in its own terminal for the chosen checkout. If the action is already running there,
**Run another** starts a second instance next to it. **Save** adds a discovered command to the
project's actions.

Agents can do the same through the T3 Code MCP tools `t3_process_list`, `t3_process_stop`,
`t3_process_restart`, `t3_project_actions_list`, and `t3_project_action_run`.
