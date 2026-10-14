/**
 * The small prompt surface the wizard needs. The real implementation wraps
 * `@inquirer/prompts` (arrow-key menus, checkboxes); tests pass a scripted fake.
 */

export interface Choice<T> {
  name: string;
  value: T;
  description?: string;
  checked?: boolean;
}

export interface Prompter {
  select<T>(message: string, choices: Choice<T>[], options?: { default?: T }): Promise<T>;
  checkbox<T>(message: string, choices: Choice<T>[], options?: { required?: boolean }): Promise<T[]>;
  input(
    message: string,
    options?: { default?: string; required?: boolean; validate?: (value: string) => true | string },
  ): Promise<string>;
  confirm(message: string, options?: { default?: boolean }): Promise<boolean>;
}

/** Thrown (by inquirer) when the user presses Ctrl+C at a prompt. */
export function isPromptExit(err: unknown): boolean {
  return err instanceof Error && err.name === "ExitPromptError";
}

export async function inquirerPrompter(): Promise<Prompter> {
  const inquirer = await import("@inquirer/prompts");
  return {
    select: (message, choices, options) =>
      inquirer.select({ message, choices, default: options?.default, pageSize: 12 }),
    checkbox: (message, choices, options) =>
      inquirer.checkbox({ message, choices, required: options?.required }),
    input: (message, options) =>
      inquirer.input({
        message,
        default: options?.default,
        required: options?.required,
        validate: options?.validate,
      }),
    confirm: (message, options) => inquirer.confirm({ message, default: options?.default }),
  };
}
