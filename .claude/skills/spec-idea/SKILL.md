---
name: spec-idea
description: Use when someone wants to propose an idea for the INITE Club CLI / MCP bridge (or for the club's MCP tools) without writing code — turns it into a plain-language spec and files it as an issue in inite-ai/inite-club-mcp.
---

# /spec-idea — propose, don't build

Explain in plain words as you go. No code, no branches.

1. Restate the idea; ask at most 3 clarifying questions.
2. Say which part it touches: the CLI (commands, sign-in, install, doctor),
   the bridge, or the club's MCP tools (server-side — still filed here, and
   labelled as such in the spec).
3. Search first:
   `gh issue list -R inite-ai/inite-club-mcp --search "<key words>" --state all`.
   If one exists, offer to comment on it instead.
4. Write the issue body with these headings: **What do you want to be
   possible?** · **Who is it for / why** · **How would you know it works?** ·
   **Spec** (problem, what a user would see, CLI surface change, files on the
   user's machine touched, risks, out of scope, zone from AGENTS.md).
5. Show it, get a yes, then file:
   `gh issue create -R inite-ai/inite-club-mcp --title "idea: <title>" --label idea --body-file <file>`.
   Without `gh`, give the person
   `https://github.com/inite-ai/inite-club-mcp/issues/new?template=product-idea.yml`
   and the text to paste.
6. Share the issue link and what happens next (a maintainer reviews it).

Never paste a token, a credential file or a private transcript into the issue.
