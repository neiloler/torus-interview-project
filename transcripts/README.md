# AI transcripts

If you used an AI coding tool, save your session transcripts here. It's optional, but it helps us understand how you worked, and we'll talk through it in the interview. If you didn't use AI, leave this folder as it is and say so in `NOTES.md`.

**Read each transcript before you commit it** and remove anything you'd rather not share: file paths, usernames, other projects, anything personal.

## Claude Code

Before you close the session, run:

```
/export transcripts/claude-code.txt
```

If you ran more than one session, export each to its own file (`claude-code-1.txt`, `claude-code-2.txt`, and so on). If you've already closed a session, the raw logs are in `~/.claude/projects/`, in a folder named after this repo's path. Copy the `.jsonl` files for this work into this folder instead.

## Other tools

Use the tool's export feature if it has one, or copy the conversation into a text or Markdown file here. For example:

- **Codex CLI:** sessions are saved under `~/.codex/sessions/`; copy the ones for this work.
- **Cursor, Copilot Chat, and similar:** export the chat from the chat panel, or copy and paste it.

Any readable format is fine.

## This submission's records

- [Conversation transcript](conversation-transcript.md): the saved user/assistant
  dialogue, including progress updates, candid questions, errors, and corrections.
  Its introduction explains the export boundary and limited formatting/privacy edits.
- [Independent reviewer reports](reviewer-reports.md): original final reports from
  the Tier 2 contract reviewer and both final reviewers, including their caveats.
- [Agent prompt snapshots](agent-prompts.md): the explicitly loaded installer and
  grilling prompts used during the session, archived as reference text.
- [Conversation brief](conversation-brief.md): the earlier running summary, retained
  separately so it is not mistaken for the dialogue transcript.
