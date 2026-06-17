/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import React from 'react';
import { JupyterFrontEndPlugin } from '@jupyterlab/application';
import {
  IChatCommandProvider,
  IChatCommandRegistry,
  IInputModel,
  ChatCommand
} from '@jupyter/chat';
import TerminalIcon from '@mui/icons-material/Terminal';

import { getPersonaCommands } from '../api';

const PERSONA_COMMAND_PROVIDER_ID =
  '@jupyter-ai/chat-commands:persona-command-provider';

/**
 * Chat command provider that surfaces `/commands` registered by the persona
 * `@`-mentioned in the current input.
 *
 * Trigger: the user's `currentWord` starts with `/` AND is the first non-space
 * token after any leading `@-mention`. This lets users discover persona-scoped
 * commands by typing `@persona /` at the start of the input.
 *
 * Submission is a no-op — the persona's `dispatch_command` runs server-side
 * once the message reaches `PersonaManager._broadcast`.
 */
export class PersonaCommandProvider implements IChatCommandProvider {
  public id: string = PERSONA_COMMAND_PROVIDER_ID;

  async listCommandCompletions(
    inputModel: IInputModel
  ): Promise<ChatCommand[]> {
    // Match the activation rules of the legacy SlashCommandProvider:
    // suggestions only appear when the user's *current word* equals the first
    // whitespace-delimited token of the input AND that token starts with `/`.
    const value = inputModel.value ?? '';
    const firstWord = getFirstWord(value);
    if (inputModel.currentWord !== firstWord) {
      return [];
    }
    if (!firstWord || !firstWord.startsWith('/')) {
      return [];
    }

    const existingMentions = getExistingMentions(inputModel);
    if (existingMentions.size > 1) {
      return [];
    }

    const personaMentionName =
      existingMentions.size === 1
        ? (existingMentions.values().next().value ?? null)
        : null;

    // Use the chat context's name (file path) when available; fall back to an
    // empty string so the server can resolve the active chat from the URL on
    // its own. The server returns an empty list when it can't resolve.
    const chatPath = inputModel.chatContext?.name ?? '';
    const commands = await getPersonaCommands(chatPath, personaMentionName);

    const suggestions: ChatCommand[] = [];
    for (const cmd of commands) {
      if (!cmd.name.startsWith(firstWord)) {
        continue;
      }
      suggestions.push({
        name: cmd.name,
        providerId: this.id,
        description: cmd.description,
        icon: <TerminalIcon />,
        spaceOnAccept: true
      });
    }
    return suggestions;
  }

  async onSubmit(_inputModel: IInputModel): Promise<void> {
    // No-op. Persona /commands are dispatched by the server-side
    // PersonaManager when the message is routed.
  }
}

function getExistingMentions(inputModel: IInputModel): Set<string> {
  const matches = (inputModel.value ?? '').matchAll(/@([\w-]+)/g);
  const names = new Set<string>();
  for (const m of matches) {
    if (m[1]) {
      names.add(m[1]);
    }
  }
  return names;
}

/**
 * Returns the first whitespace-delimited token in `input`, or `null` if there
 * is none. Mirrors the helper used by the legacy SlashCommandProvider so that
 * activation rules stay consistent.
 */
function getFirstWord(input: string): string | null {
  let start = 0;
  while (start < input.length && /\s/.test(input[start])) {
    start++;
  }
  let end = start;
  while (end < input.length && !/\s/.test(input[end])) {
    end++;
  }
  const firstWord = input.substring(start, end);
  return firstWord ? firstWord : null;
}

export const personaCommandPlugin: JupyterFrontEndPlugin<void> = {
  id: PERSONA_COMMAND_PROVIDER_ID,
  description:
    'Adds autocomplete for persona-scoped /commands in the Jupyter AI chat input.',
  autoStart: true,
  requires: [IChatCommandRegistry],
  activate: (_app, registry: IChatCommandRegistry) => {
    registry.addProvider(new PersonaCommandProvider());
  }
};
